import { nanoid } from 'nanoid';
import type { FormulaDeclaration } from '@slaclab/canopy-screen-ir';
import type { ScreenModel, ScreenMeta, Widget, WidgetType, WidgetProps } from '../../types/widget';
import { createDefaultScreen, createDefaultScreenMeta, ALL_WIDGET_TYPES } from '../../types/widget';

function numProp(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Parses a TSX screen file back into the internal ScreenModel.
 * Uses regex-based parsing — handles both our generated format and
 * hand-edited files with reasonable flexibility.
 */
export function parseTSX(code: string): ScreenModel {
  const screen = createDefaultScreen();

  // Parse screenMeta
  screen.meta = parseScreenMeta(code);

  // Parse widgets from JSX
  const widgetMatches = parseWidgetElements(code);
  let zIndex = 1;

  for (const match of widgetMatches) {
    const id = nanoid(8);
    const widget: Widget = {
      id,
      type: match.type as WidgetType,
      name: `${match.type}_${id}`,
      layout: {
        x: numProp(match.props.x, 0),
        y: numProp(match.props.y, 0),
        width: numProp(match.props.w ?? match.props.width, 100),
        height: numProp(match.props.h ?? match.props.height, 32),
      },
      visible: match.props.visible !== false,
      rotation: numProp(match.props.rotation, 0),
      rules: [],
      actions: [],
      props: buildWidgetProps(match.props),
      zIndex: zIndex++,
    };

    screen.widgets[id] = widget;
    screen.rootWidgetIds.push(id);
  }

  return screen;
}

// ── Screen Meta Parser ──────────────────────────────────────────────────────

function parseScreenMeta(code: string): ScreenMeta {
  const meta = createDefaultScreenMeta();

  // Try multiple patterns for the meta block
  // Pattern 1: const screenMeta = { ... } satisfies ScreenProps;
  // Pattern 2: const screenMeta = { ... };
  // Pattern 3: const screenMeta: ScreenProps = { ... };
  // Pattern 4: look for common meta properties anywhere
  const metaPatterns = [
    /const\s+screenMeta\s*=\s*\{([\s\S]*?)\}\s*satisfies/,
    /const\s+screenMeta\s*(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\};/,
    /const\s+meta\s*=\s*\{([\s\S]*?)\};/,
  ];

  let block = '';
  for (const pattern of metaPatterns) {
    const match = code.match(pattern);
    if (match) {
      block = match[1];
      break;
    }
  }

  if (block) {
    const title = block.match(/title:\s*['"`]([^'"`]*)['"`]/);
    if (title) meta.title = title[1];

    const width = block.match(/width:\s*(\d+)/);
    if (width) meta.width = parseInt(width[1]);

    const height = block.match(/height:\s*(\d+)/);
    if (height) meta.height = parseInt(height[1]);

    const bg = block.match(/backgroundColor:\s*['"`]([^'"`]*)['"`]/);
    if (bg) meta.backgroundColor = bg[1];

    // Parse macros object
    const macrosMatch = block.match(/macros:\s*\{([^}]*)\}/);
    if (macrosMatch) {
      const macroEntries = macrosMatch[1].matchAll(/(\w+):\s*['"`]([^'"`]*)['"`]/g);
      for (const entry of macroEntries) {
        meta.macros[entry[1]] = entry[2];
      }
    }
  }

  // Parse the screen-level formulas array. Matched against the full code (not
  // the truncated meta block) and via balanced-bracket scan, since formula
  // objects nest braces the meta-block regex would stop at.
  const formulas = parseFormulas(code);
  if (formulas) meta.formulas = formulas;

  // Fallback: try to extract title from the component name
  if (meta.title === 'New Screen') {
    const compMatch = code.match(/export\s+(?:default\s+)?function\s+(\w+)/);
    if (compMatch && compMatch[1] !== 'App') {
      // Convert PascalCase to spaced: "QuadControlPanel" -> "Quad Control Panel"
      meta.title = compMatch[1].replace(/([A-Z])/g, ' $1').trim();
    }
  }

  return meta;
}

/**
 * Extract the `formulas: [ ... ]` JSON array from a generated meta block.
 * Uses a balanced-bracket scan (formula objects nest braces) and `JSON.parse`,
 * returning `undefined` if absent or unparseable — formulas are best-effort.
 */
function parseFormulas(code: string): FormulaDeclaration[] | undefined {
  const key = code.indexOf('formulas:');
  if (key === -1) return undefined;
  const open = code.indexOf('[', key);
  if (open === -1) return undefined;

  let depth = 0;
  let inString: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\')
        i++; // skip escaped char
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(code.slice(open, i + 1));
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

// ── Widget Element Parser ───────────────────────────────────────────────────

interface ParsedWidget {
  type: string;
  props: Record<string, unknown>;
}

function parseWidgetElements(code: string): ParsedWidget[] {
  const widgets: ParsedWidget[] = [];
  const typePattern = ALL_WIDGET_TYPES.join('|');

  // Use [\s\S] instead of [^>] to handle multi-line props
  // Match self-closing: <Type ... />
  const selfClosingRe = new RegExp(`<(${typePattern})\\b([\\s\\S]*?)/>`, 'g');
  for (const match of code.matchAll(selfClosingRe)) {
    // Make sure this isn't inside a comment or string
    const propsStr = match[2];
    // Skip if the match contains a closing tag (it's not self-closing)
    if (propsStr.includes('</')) continue;
    widgets.push({
      type: match[1],
      props: parsePropsString(propsStr),
    });
  }

  // Match opening tags with children: <Type ...>...</Type>
  const openTagRe = new RegExp(`<(${typePattern})\\b([\\s\\S]*?)>`, 'g');
  for (const match of code.matchAll(openTagRe)) {
    const propsStr = match[2];
    // Skip self-closing (already captured) and closing tags
    if (propsStr.trimEnd().endsWith('/') || match[0].includes('</')) continue;

    // Check if we already have this widget (same type + same props)
    const parsed = parsePropsString(propsStr);
    const isDuplicate = widgets.some(
      (w) => w.type === match[1] && w.props.x === parsed.x && w.props.y === parsed.y
    );
    if (!isDuplicate) {
      widgets.push({ type: match[1], props: parsed });
    }
  }

  return widgets;
}

function parsePropsString(propsStr: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  // Normalize whitespace for easier parsing
  const normalized = propsStr.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  // Match prop="string value"
  for (const match of normalized.matchAll(/(\w+)="([^"]*)"/g)) {
    props[match[1]] = match[2];
  }

  // Match prop='string value'
  for (const match of normalized.matchAll(/(\w+)='([^']*)'/g)) {
    if (!(match[1] in props)) {
      props[match[1]] = match[2];
    }
  }

  // Match prop={number} (including negative numbers and decimals)
  for (const match of normalized.matchAll(/(\w+)=\{(-?\d+(?:\.\d+)?)\}/g)) {
    props[match[1]] = parseFloat(match[2]);
  }

  // Match prop={true/false}
  for (const match of normalized.matchAll(/(\w+)=\{(true|false)\}/g)) {
    props[match[1]] = match[2] === 'true';
  }

  // Match prop={"string"} or prop={'string'}
  for (const match of normalized.matchAll(/(\w+)=\{["']([^"']*)["']\}/g)) {
    if (!(match[1] in props)) {
      props[match[1]] = match[2];
    }
  }

  // Match boolean shorthand props (prop without value = true)
  // Look for word boundaries: ` propName ` or ` propName/` or ` propName>`
  for (const match of normalized.matchAll(/\s(\w+)(?=\s+\w+=|\s*\/?\s*$)/g)) {
    const key = match[1];
    if (!(key in props) && !['className', 'style', 'key', 'ref', 'children'].includes(key)) {
      props[key] = true;
    }
  }

  return props;
}

function buildWidgetProps(parsed: Record<string, unknown>): WidgetProps {
  const props: WidgetProps = {};

  // Map 'pv' shorthand to pvName
  if (typeof parsed.pv === 'string') {
    props.pvName = parsed.pv;
  }
  if (typeof parsed.pvName === 'string') {
    props.pvName = parsed.pvName;
  }

  // Copy known widget props
  const propKeys = [
    'label',
    'text',
    'format',
    'precision',
    'showUnits',
    'precisionFromPV',
    'foregroundColor',
    'backgroundColor',
    'borderColor',
    'fontSize',
    'fontFamily',
    'opacity',
    'alarmSensitiveBorder',
    'alarmSensitiveContent',
    'confirmOnWrite',
    'confirmMessage',
    'minValue',
    'maxValue',
    'limitsFromPV',
    'enabled',
    'pressValue',
    'releaseValue',
    'onLabel',
    'offLabel',
    'onColor',
    'offColor',
    'bit',
    'orientation',
    'showScale',
    'showValueLabel',
    'increment',
    'lineColor',
    'lineWidth',
    'lineStyle',
    'fillColor',
    'fill',
    'cornerRadius',
    'startAngle',
    'spanAngle',
    'src',
    'mode',
    'stretchMode',
    'file',
    'resizeMode',
    'layoutMode',
    'numBits',
    'startBit',
    'bigEndian',
  ];

  for (const key of propKeys) {
    if (parsed[key] !== undefined) {
      props[key] = parsed[key];
    }
  }

  return props;
}
