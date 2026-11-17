// IR widget type ↔ Screen Builder widget mapping.
//
// This is the contract for BOTH directions: `importScreenJSON.ts` (IR →
// ScreenModel) and `../export/exportScreenJSON.ts` (ScreenModel → IR) both
// build on the tables here. Pure: no React, no store.
//
// Two contracts drive the design:
//  - **Nothing is silently dropped.** `unknown-widget` (and any IR type not in
//    the table) becomes a `Rectangle` placeholder that preserves the original
//    class + props, and is reported. This mirrors the converter's D11 contract.
//    On save, an unknown-widget placeholder normalizes back to `'rectangle'`,
//    keeping `originalClass`/`originalProps` as plain props.
//  - **Eject must not break.** `Widget.type` is the closed `WidgetType` union
//    that `generateTSX` emits verbatim, so every mapping target is a real
//    catalog type — never a raw IR id.
//
// Reserved carrier props (documented fully in `exportScreenJSON.ts`, which
// writes them): the exporter stashes SB `Widget` fields that have no IR field
// as widget props under these reserved names, and `importScreenJSON.ts` lifts
// them back OUT of props onto the `Widget` — `name`, `actions`, `visible`,
// `rotation`, `locked`. A mapper here never needs to special-case them; they
// ride through the generic per-type prop bag like any other prop and are
// lifted post-hoc by the importer.
//
// Per-entry `consumes`: each `TYPE_MAP` entry declares exactly the IR prop
// keys ITS mapper reads, and the generic pass-through in `mapWidget` skips
// only the current entry's consumed keys (plus keys already written). The
// per-type scoping is load-bearing: a key one type consumes (`label` on
// `pv-button`) must still pass through on types that don't (`pv-label`).

import type { WidgetNode } from '@slaclab/canopy-screen-ir';
import type { Action, WidgetType, WidgetProps } from '../../types/widget';

export interface MapResult {
  sbType: WidgetType;
  props: WidgetProps;
  /** Synthesized actions (e.g. `related-display-button` → `open_display`). */
  actions: Action[];
  /** IR prop keys deliberately discarded (no SB home). For the report. */
  droppedProps: string[];
  /** Set when the widget was degraded (chrome/semantics lost). For the report. */
  degradeReason?: string;
  /**
   * The mapper fell back to a placeholder (an `unknown-widget` or an IR type
   * with no SB mapping). `originalClass` is the preserved source class.
   */
  unknown?: { originalClass: string };
}

// ── Coercion helpers (mirror parseTSX's numProp style) ───────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** Assign `props[key] = value` only when `value` is defined. */
function put(props: WidgetProps, key: string, value: unknown): void {
  if (value !== undefined) props[key] = value;
}

// ── Per-type prop mappers ────────────────────────────────────────────────────
// Each reads the IR props bag and writes the SB-named props. Keys not listed
// in the entry's `consumes` are passed through verbatim by the generic
// pass-through below (the `WidgetProps` index signature allows arbitrary
// keys), so unknown-but-harmless props survive rather than vanish.

type IRProps = Record<string, unknown>;
type PropMapper = (ir: IRProps, props: WidgetProps) => void;

const FOREGROUND = ['foregroundColor', 'backgroundColor', 'borderColor', 'fontSize', 'fontFamily'];
function copyAppearance(ir: IRProps, props: WidgetProps): void {
  for (const k of FOREGROUND) put(props, k, ir[k]);
}

interface TypeMapEntry {
  sbType: WidgetType;
  map: PropMapper;
  /** IR prop keys this mapper reads; the generic pass-through skips these. */
  consumes: readonly string[];
  degradeReason?: string;
}

const TYPE_MAP: Record<string, TypeMapEntry> = {
  'text-label': {
    sbType: 'StaticLabel',
    // `label` is only a fallback when `text` is absent; a node carrying both
    // keeps both.
    map: (ir, p) => {
      put(p, 'text', str(ir.text) ?? str(ir.label));
      if (ir.text !== undefined && ir.label !== undefined) put(p, 'label', ir.label);
      copyAppearance(ir, p);
    },
    consumes: ['text', 'label', ...FOREGROUND],
  },
  'pv-label': {
    sbType: 'PVTextDisplay',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'format', ir.format);
      put(p, 'precision', num(ir.precision));
      put(p, 'showUnits', bool(ir.showUnits));
      put(p, 'precisionFromPV', bool(ir.precisionFromPV));
      copyAppearance(ir, p);
    },
    consumes: ['pv', 'format', 'precision', 'showUnits', 'precisionFromPV', ...FOREGROUND],
  },
  'pv-text-input': {
    sbType: 'PVTextInput',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'confirmOnWrite', bool(ir.confirmOnWrite));
      put(p, 'confirmMessage', str(ir.confirmMessage));
    },
    consumes: ['pv', 'confirmOnWrite', 'confirmMessage'],
  },
  'pv-button': {
    sbType: 'PVButton',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'label', str(ir.label));
      put(p, 'pressValue', ir.pressValue);
      put(p, 'releaseValue', ir.releaseValue);
    },
    consumes: ['pv', 'label', 'pressValue', 'releaseValue'],
  },
  'regular-button': {
    sbType: 'PVButton',
    map: (ir, p) => {
      put(p, 'label', str(ir.label));
      put(p, 'pressValue', ir.pressValue);
      put(p, 'releaseValue', ir.releaseValue);
    },
    consumes: ['label', 'pressValue', 'releaseValue'],
  },
  'pv-checkbox': {
    sbType: 'PVCheckbox',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'label', str(ir.label));
    },
    consumes: ['pv', 'label'],
  },
  'pv-enum-combobox': {
    sbType: 'PVDropdown',
    map: (ir, p) => put(p, 'pvName', str(ir.pv)),
    consumes: ['pv'],
  },
  'pv-radio-group': {
    sbType: 'PVRadioGroup',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'orientation', ir.orientation);
      put(p, 'alarmSensitiveBorder', bool(ir.alarmSensitive));
    },
    consumes: ['pv', 'orientation', 'alarmSensitive'],
  },
  'pv-slider': {
    sbType: 'PVSlider',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'minValue', num(ir.min));
      put(p, 'maxValue', num(ir.max));
      put(p, 'orientation', ir.orientation);
      put(p, 'showValueLabel', bool(ir.showValue));
      put(p, 'increment', num(ir.increment));
      put(p, 'showScale', bool(ir.showScale));
      put(p, 'limitsFromPV', bool(ir.limitsFromPV));
    },
    consumes: [
      'pv',
      'min',
      'max',
      'orientation',
      'showValue',
      'increment',
      'showScale',
      'limitsFromPV',
    ],
  },
  'pv-progress-bar': {
    sbType: 'PVProgressBar',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'minValue', num(ir.min));
      put(p, 'maxValue', num(ir.max));
      put(p, 'orientation', ir.orientation);
    },
    consumes: ['pv', 'min', 'max', 'orientation'],
  },
  'pv-meter': {
    sbType: 'PVMeter',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'minValue', num(ir.min));
      put(p, 'maxValue', num(ir.max));
      put(p, 'label', str(ir.label));
      put(p, 'showValueLabel', bool(ir.showValue));
      put(p, 'units', str(ir.units));
    },
    consumes: ['pv', 'min', 'max', 'label', 'showValue', 'units'],
  },
  'pv-byte-led': {
    sbType: 'PVByteIndicator',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'numBits', num(ir.numBits));
      put(p, 'startBit', num(ir.shift));
      put(p, 'bigEndian', bool(ir.bigEndian));
      put(p, 'onColor', str(ir.onColor));
      put(p, 'offColor', str(ir.offColor));
    },
    consumes: ['pv', 'numBits', 'shift', 'bigEndian', 'onColor', 'offColor'],
  },
  'pv-led': {
    sbType: 'PVLed',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'bit', num(ir.bit));
      put(p, 'onColor', str(ir.onColor));
      put(p, 'offColor', str(ir.offColor));
    },
    consumes: ['pv', 'bit', 'onColor', 'offColor'],
  },
  'pv-symbol': {
    sbType: 'PVSymbol',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'defaultSrc', str(ir.defaultSrc));
      put(p, 'stretchMode', ir.stretchMode);
      if (Array.isArray(ir.states)) p.states = ir.states as WidgetProps['states'];
    },
    consumes: ['pv', 'defaultSrc', 'stretchMode', 'states'],
  },
  'pv-image-view': {
    sbType: 'Image',
    map: (ir, p) => {
      p.mode = 'live';
      put(p, 'pvName', str(ir.pv));
      put(p, 'imageWidth', num(ir.imageWidth));
      put(p, 'imageHeight', num(ir.imageHeight));
      put(p, 'imageMin', num(ir.imageMin));
      put(p, 'imageMax', num(ir.imageMax));
      // Accept both `src` (unified) and `defaultSrc` (legacy) as the fallback.
      put(p, 'src', str(ir.src) ?? str(ir.defaultSrc));
      put(p, 'stretchMode', ir.stretchMode);
    },
    consumes: [
      'pv',
      'imageWidth',
      'imageHeight',
      'imageMin',
      'imageMax',
      'defaultSrc',
      'src',
      'stretchMode',
    ],
  },
  'pv-time-plot': {
    sbType: 'PVTimePlot',
    map: (ir, p) => {
      put(p, 'pvName', str(ir.pv));
      put(p, 'title', str(ir.title));
      put(p, 'yLabel', str(ir.yLabel));
      put(p, 'timeWindow', num(ir.timeWindow));
      put(p, 'color', str(ir.color));
    },
    consumes: ['pv', 'title', 'yLabel', 'timeWindow', 'color'],
  },
  'pv-scatter-plot': {
    sbType: 'PVScatterPlot',
    map: (ir, p) => {
      put(p, 'pvNameX', str(ir.xPv));
      put(p, 'pvNameY', str(ir.yPv));
      put(p, 'title', str(ir.title));
      put(p, 'xLabel', str(ir.xLabel));
      put(p, 'yLabel', str(ir.yLabel));
      put(p, 'maxPoints', num(ir.maxPoints));
      put(p, 'color', str(ir.color));
    },
    consumes: ['xPv', 'yPv', 'title', 'xLabel', 'yLabel', 'maxPoints', 'color'],
  },
  'embedded-display': {
    sbType: 'EmbeddedScreen',
    map: (ir, p) => {
      put(p, 'file', str(ir.file));
      put(p, 'macros', ir.macros);
      put(p, 'resizeMode', ir.resizeMode);
    },
    consumes: ['file', 'macros', 'resizeMode'],
  },
  'image-view': {
    sbType: 'Image',
    map: (ir, p) => {
      p.mode = 'static';
      // Accept both `src` (unified) and `filename` (legacy) as the source.
      put(p, 'src', str(ir.src) ?? str(ir.filename));
      put(p, 'stretchMode', ir.stretchMode);
    },
    consumes: ['src', 'filename', 'stretchMode'],
  },
  'shell-command-button': {
    sbType: 'PVShellCommand',
    map: (ir, p) => {
      put(p, 'command', str(ir.command));
      put(p, 'label', str(ir.label));
      put(p, 'showIcon', bool(ir.showIcon));
      put(p, 'allowMultipleExecutions', bool(ir.allowMultipleExecutions));
      put(p, 'alarmSensitiveContent', bool(ir.alarmSensitive));
      put(p, 'alarmSensitiveBorder', bool(ir.alarmBorder));
    },
    consumes: [
      'command',
      'label',
      'showIcon',
      'allowMultipleExecutions',
      'alarmSensitive',
      'alarmBorder',
    ],
  },
  'waveform-plot': {
    sbType: 'PVWaveformPlot',
    map: (ir, p) => {
      put(p, 'title', str(ir.title));
      put(p, 'curves', ir.curves);
      put(p, 'yAxes', ir.yAxes);
      put(p, 'xLabels', ir.xLabels);
    },
    consumes: ['title', 'curves', 'yAxes', 'xLabels'],
  },
  // A non-root QWidget panel imports as a plain Group (children + z-order
  // survive; there is no chrome to lose).
  'qwidget-container': {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
  },
  'related-display-button': {
    sbType: 'PVRelatedDisplayButton',
    map: (ir, p) => {
      put(p, 'label', str(ir.label));
      put(p, 'file', str(ir.file));
      if (ir.macros && typeof ir.macros === 'object') {
        p.macros = ir.macros as Record<string, string>;
      }
      const t = str(ir.target);
      if (t === 'tab' || t === 'window' || t === 'replace') {
        p.target = t;
      }
    },
    consumes: ['label', 'file', 'macros', 'target'],
  },
  // Containers degrade to Group: children + z-order survive, chrome does not.
  frame: {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason: 'frame border/shadow chrome is not represented; rendered as a plain Group',
  },
  'group-box': {
    sbType: 'Group',
    map: (ir, p) => {
      p.layoutMode = 'absolute';
      put(p, 'label', str(ir.title));
    },
    consumes: ['title'],
    degradeReason: 'group-box title chrome is not represented; preserved as label on a plain Group',
  },
  'scroll-area': {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason:
      'scroll-area scrolling/clipping is not represented; children laid out absolutely',
  },
  tabs: {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason: 'tabs structure is not represented; pages flattened into a single Group',
  },

  // ── Identity entries for SB-native types ──────────────────────────────────
  // The exporter emits these kebab ids verbatim for widget types that already
  // have a 1:1 IR shape (either because they're pure drawings with no rename
  // table, or because the SB model already uses the IR's own key names). Each
  // copies every IR prop through unchanged, so import is total over
  // everything the exporter can produce.
  rectangle: {
    sbType: 'Rectangle',
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  ellipse: {
    sbType: 'Ellipse',
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  arc: {
    sbType: 'Arc',
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  line: {
    sbType: 'Line',
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  polygon: {
    sbType: 'Polygon',
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  group: {
    sbType: 'Group',
    // Verbatim — do NOT force layoutMode; the exporter/model already carries
    // whatever layoutMode the widget had.
    map: (ir, p) => copyVerbatim(ir, p),
    consumes: [],
  },
  'pv-toggle': {
    sbType: 'PVToggle',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
  'pv-spinbox': {
    sbType: 'PVSpinbox',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
  'pv-tabs': {
    sbType: 'PVTabs',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
  'pv-gauge': {
    sbType: 'PVGauge',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
  'pv-tank': {
    sbType: 'PVTank',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
  'pv-thermometer': {
    sbType: 'PVThermometer',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
  },
};

/** Copy every IR prop through verbatim, under its own key. */
function copyVerbatim(ir: IRProps, props: WidgetProps): void {
  for (const [k, v] of Object.entries(ir)) put(props, k, v);
}

/**
 * Copy every IR prop through verbatim, with one tolerance: if `ir.pv` is a
 * string and `ir.pvName` is absent, write it as `pvName` instead of `pv`
 * (hand-authored convenience alias — these SB-native types otherwise use
 * `pvName`, so a hand-authored IR doc using the more common `pv` key still
 * binds correctly).
 */
function copyPvFlavoredVerbatim(ir: IRProps, props: WidgetProps): void {
  for (const [k, v] of Object.entries(ir)) {
    if (k === 'pv' && typeof v === 'string' && ir.pvName === undefined) {
      put(props, 'pvName', v);
    } else {
      put(props, k, v);
    }
  }
}

/**
 * Map one IR widget node to its SB widget type + props.
 *
 * `unknown-widget` and any unrecognized IR type fall back to a `Rectangle`
 * placeholder that preserves the original class/props and is reported by the
 * caller. This is total — no IR type ever leaks through as a non-catalog type.
 */
export function mapWidget(node: WidgetNode): MapResult {
  const ir = (node.props ?? {}) as IRProps;

  if (node.type === 'unknown-widget' || !(node.type in TYPE_MAP)) {
    return mapUnknown(node, ir);
  }

  const entry = TYPE_MAP[node.type];
  const props: WidgetProps = {};
  entry.map(ir, props);

  const actions: Action[] = [];

  // Generic pass-through: keep any IR prop THIS entry's mapper didn't
  // consume, so a newer-than-SB prop survives import rather than vanishing.
  const consumed = entry.consumes;
  for (const [key, value] of Object.entries(ir)) {
    if (!consumed.includes(key) && !(key in props)) props[key] = value;
  }

  return {
    sbType: entry.sbType,
    props,
    actions,
    droppedProps: [],
    degradeReason: entry.degradeReason,
  };
}

function mapUnknown(node: WidgetNode, ir: IRProps): MapResult {
  const originalClass = str(ir.originalClass) ?? node.type;
  const props: WidgetProps = {
    label: originalClass,
    fill: false,
    originalClass,
    originalProps: ir.originalProps ?? ir,
  };
  return {
    sbType: 'Rectangle',
    props,
    actions: [],
    droppedProps: [],
    degradeReason: `unmapped widget '${originalClass}' rendered as a placeholder`,
    unknown: { originalClass },
  };
}
