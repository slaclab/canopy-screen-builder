import type { ScreenModel, Widget, WidgetType } from '../../types/widget';
import { WIDGET_CATALOG } from '../../types/widget';

/**
 * Generates a human-readable TSX file from the internal screen model.
 * Uses string templates (Mitosis-style) — not AST manipulation.
 * Output is designed to look like a skilled developer wrote it by hand.
 */
export function generateTSX(screen: ScreenModel): string {
  const widgets = screen.rootWidgetIds
    .map((id) => screen.widgets[id])
    .filter(Boolean)
    .sort((a, b) => a.zIndex - b.zIndex);

  // Collect which widget types are used
  const usedTypes = new Set<WidgetType>();
  const collectTypes = (ids: string[]) => {
    for (const id of ids) {
      const w = screen.widgets[id];
      if (w) {
        usedTypes.add(w.type);
        if (w.children) collectTypes(w.children);
      }
    }
  };
  collectTypes(screen.rootWidgetIds);

  // Group used types by their import bucket from the central catalog.
  const inBucket = (bucket: readonly string[], t: WidgetType) => bucket.includes(t);
  const pvWrappers = [...usedTypes].filter((t) => inBucket(WIDGET_CATALOG.pvWrappers, t));
  const indicators = [...usedTypes].filter((t) => inBucket(WIDGET_CATALOG.indicators, t));
  const drawings = [...usedTypes].filter((t) => inBucket(WIDGET_CATALOG.drawings, t));
  const containers = [...usedTypes].filter((t) => inBucket(WIDGET_CATALOG.containers, t));

  const imports: string[] = [];

  if (pvWrappers.length > 0 || indicators.length > 0) {
    imports.push(`import { ${[...pvWrappers, ...indicators].join(', ')} } from '@pydm/widgets';`);
  }
  if (drawings.length > 0) {
    imports.push(`import { ${drawings.join(', ')} } from '@pydm/drawing';`);
  }
  if (containers.length > 0) {
    imports.push(`import { ${containers.join(', ')} } from '@pydm/containers';`);
  }
  imports.unshift(`import { Screen } from '@pydm/runtime';`);
  imports.unshift(`import type { ScreenProps } from '@pydm/types';`);

  // Check if any widget uses PV
  const hasPV = widgets.some((w) => w.props.pvName);
  if (hasPV) {
    imports.unshift(`import { usePV } from '@pydm/hooks';`);
  }

  // Build screen metadata
  const macroEntries = Object.entries(screen.meta.macros);
  const macrosStr =
    macroEntries.length > 0
      ? `{ ${macroEntries.map(([k, v]) => `${k}: '${v}'`).join(', ')} }`
      : '{}';

  // Screen-level formulas are author-facing data; emit them as a JSON
  // array so they round-trip losslessly through parseTSX.
  const formulasLine =
    screen.meta.formulas && screen.meta.formulas.length > 0
      ? `\n  formulas: ${JSON.stringify(screen.meta.formulas)},`
      : '';

  const metaBlock = `const screenMeta = {
  title: '${screen.meta.title}',
  width: ${screen.meta.width},
  height: ${screen.meta.height},
  backgroundColor: '${screen.meta.backgroundColor}',
  macros: ${macrosStr},${formulasLine}
} satisfies ScreenProps;`;

  // Build component name from title
  const componentName =
    screen.meta.title
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, (c) => c.toUpperCase()) || 'Screen';

  // Build JSX for widgets
  const widgetJSX = widgets.map((w) => generateWidgetJSX(w, screen, 3)).join('\n');

  // Build the component
  const component = `export default function ${componentName}({ macros }: { macros?: Record<string, string> }) {
  return (
    <Screen meta={screenMeta} macros={macros}>
${widgetJSX}
    </Screen>
  );
}`;

  // Assemble file
  const sections = [imports.join('\n'), '', metaBlock, '', component, ''];

  return sections.join('\n');
}

function generateWidgetJSX(widget: Widget, screen: ScreenModel, indent: number): string {
  const pad = ' '.repeat(indent * 2);
  const props = buildPropsString(widget);

  if (widget.children && widget.children.length > 0) {
    const childJSX = widget.children
      .map((id) => screen.widgets[id])
      .filter(Boolean)
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((child) => generateWidgetJSX(child, screen, indent + 1))
      .join('\n');

    return `${pad}<${widget.type}${props}>\n${childJSX}\n${pad}</${widget.type}>`;
  }

  return `${pad}<${widget.type}${props} />`;
}

function buildPropsString(widget: Widget): string {
  const parts: string[] = [];

  // Layout props
  parts.push(`x={${widget.layout.x}}`);
  parts.push(`y={${widget.layout.y}}`);
  parts.push(`w={${widget.layout.width}}`);
  parts.push(`h={${widget.layout.height}}`);

  // PV name
  if (widget.props.pvName) {
    parts.push(`pv="${widget.props.pvName}"`);
  }

  // Common props (skip defaults and layout)
  const skipKeys = new Set(['pvName', 'layoutMode']);
  const defaults: Record<string, unknown> = {
    alarmSensitiveBorder: true,
    alarmSensitiveContent: false,
    visible: true,
    opacity: 0,
    fill: false,
    orientation: 'horizontal',
    showUnits: false,
    precisionFromPV: true,
    confirmOnWrite: false,
    enabled: true,
    limitsFromPV: true,
  };

  for (const [key, value] of Object.entries(widget.props)) {
    if (skipKeys.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (defaults[key] === value) continue;

    if (typeof value === 'string') {
      parts.push(`${key}="${value}"`);
    } else if (typeof value === 'boolean') {
      parts.push(value ? key : `${key}={false}`);
    } else if (typeof value === 'number') {
      parts.push(`${key}={${value}}`);
    } else if (typeof value === 'object') {
      parts.push(`${key}={${JSON.stringify(value)}}`);
    }
  }

  // Rotation
  if (widget.rotation) {
    parts.push(`rotation={${widget.rotation}}`);
  }

  // Visibility
  if (!widget.visible) {
    parts.push(`visible={false}`);
  }

  if (parts.length === 0) return '';

  // Format: if few props, inline. If many, one per line.
  if (parts.length <= 4) {
    return ' ' + parts.join(' ');
  }

  return '\n' + parts.map((p) => `        ${p}`).join('\n') + '\n      ';
}
