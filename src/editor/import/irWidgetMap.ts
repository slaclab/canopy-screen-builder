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
//    The node's own type and props ride along in `Widget.ir`, so a save writes
//    the original node back instead of a rectangle.
//  - **A save gives back what was opened.** Whatever the model cannot hold —
//    the IR type where several share one builder type, a prop value a mapper
//    could not coerce — goes into `Widget.ir` (see `WidgetIRPassthrough`) for
//    `exportScreenJSON.ts` to re-emit.
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
import type { Action, WidgetIRPassthrough, WidgetType, WidgetProps } from '../../types/widget';

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
  /** IR data with no model home, to be stored on `Widget.ir`. */
  ir?: WidgetIRPassthrough;
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
  /**
   * Set on IR types the exporter cannot tell from the model alone because
   * another IR type maps to the same builder type. The importer then records
   * the IR type on `Widget.ir.type` and a save re-emits it.
   */
  alias?: {
    /** Model prop key -> IR prop key, applied on a save under this type. */
    renames: Readonly<Record<string, string>>;
    /** Only these nodes need the type recorded (default: every node of the type). */
    when?: (ir: IRProps) => boolean;
  };
  /**
   * The type's model key is `pvName` and it saves as `pvName`, but a
   * hand-authored `pv` is read as one (see `copyPvFlavoredVerbatim`).
   */
  pvAlias?: boolean;
}

/** The `open_display` target a `related-display-button` imports with. */
export const RELATED_DISPLAY_TARGET = 'window';

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
    // A pv-button with no `pv` (the converter emits these for a button that
    // only reads a state PV) would otherwise save as `regular-button`.
    alias: { renames: { pvName: 'pv' }, when: (ir) => str(ir.pv) === undefined },
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
    sbType: 'ScreenImage',
    map: (ir, p) => {
      put(p, 'filename', str(ir.src));
      put(p, 'stretchMode', ir.stretchMode);
    },
    consumes: ['src', 'stretchMode'],
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
    alias: { renames: {} },
  },
  'related-display-button': {
    sbType: 'PVButton',
    // `file`/`macros` are turned into an open_display Action by mapWidget, not
    // props — so they're listed in `consumes` to keep them off the button.
    map: (ir, p) => put(p, 'label', str(ir.label)),
    consumes: ['label', 'file', 'macros'],
    degradeReason:
      'related-display navigation carried as an open_display action; review target window behavior',
    alias: { renames: {} },
  },
  // Containers degrade to Group: children + z-order survive, chrome does not.
  frame: {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason: 'frame border/shadow chrome is not represented; rendered as a plain Group',
    alias: { renames: {} },
  },
  'group-box': {
    sbType: 'Group',
    map: (ir, p) => {
      p.layoutMode = 'absolute';
      put(p, 'label', str(ir.title));
    },
    consumes: ['title'],
    degradeReason: 'group-box title chrome is not represented; preserved as label on a plain Group',
    alias: { renames: { label: 'title' } },
  },
  'scroll-area': {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason:
      'scroll-area scrolling/clipping is not represented; children laid out absolutely',
    alias: { renames: {} },
  },
  tabs: {
    sbType: 'Group',
    map: (_ir, p) => {
      p.layoutMode = 'absolute';
    },
    consumes: [],
    degradeReason: 'tabs structure is not represented; pages flattened into a single Group',
    alias: { renames: {} },
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
    pvAlias: true,
  },
  'pv-spinbox': {
    sbType: 'PVSpinbox',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
    pvAlias: true,
  },
  'pv-tabs': {
    sbType: 'PVTabs',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
    pvAlias: true,
  },
  'pv-gauge': {
    sbType: 'PVGauge',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
    pvAlias: true,
  },
  'pv-tank': {
    sbType: 'PVTank',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
    pvAlias: true,
  },
  'pv-thermometer': {
    sbType: 'PVThermometer',
    map: (ir, p) => copyPvFlavoredVerbatim(ir, p),
    consumes: [],
    pvAlias: true,
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

  if (!isKnownIRType(node.type)) {
    return mapUnknown(node, ir);
  }

  const entry = TYPE_MAP[node.type];
  const props: WidgetProps = {};
  entry.map(ir, props);

  const actions: Action[] = [];
  // Consumed IR keys whose value now lives in a synthesized action.
  const inAction = new Set<string>();

  // related-display-button click opens another screen — carry that as an SB
  // open_display Action rather than props on the button.
  if (node.type === 'related-display-button') {
    const file = str(ir.file);
    if (file) {
      const macros = ir.macros;
      const hasMacros = macros !== null && typeof macros === 'object';
      actions.push({
        type: 'open_display',
        file,
        target: RELATED_DISPLAY_TARGET,
        ...(hasMacros ? { macros: macros as Record<string, string> } : {}),
      });
      inAction.add('file');
      if (hasMacros) inAction.add('macros');
    }
  }

  // Generic pass-through: keep any IR prop THIS entry's mapper didn't
  // consume, so a newer-than-SB prop survives import rather than vanishing.
  const consumed = entry.consumes;
  for (const [key, value] of Object.entries(ir)) {
    if (!consumed.includes(key) && !(key in props)) props[key] = value;
  }

  const passthrough: WidgetIRPassthrough = {};
  const synthesized: WidgetProps = {};
  entry.map({}, synthesized);

  // A consumed key is lost when its mapper coerces the value to nothing
  // (pv-label `precision: "fromPV"`, a `${MACRO}` where a number goes). Probe
  // the mapper with that key alone: if it writes no more than it does for an
  // empty bag, the value has no model home and rides in the passthrough.
  const unrepresented: Record<string, unknown> = {};
  for (const key of entry.consumes) {
    const value = ir[key];
    if (value === undefined || inAction.has(key)) continue;
    const probe: WidgetProps = {};
    entry.map({ [key]: value }, probe);
    if (sameShallow(probe, synthesized)) unrepresented[key] = value;
  }
  if (Object.keys(unrepresented).length > 0) passthrough.props = unrepresented;

  if (entry.alias && (entry.alias.when?.(ir) ?? true)) {
    passthrough.type = node.type;
    if (Object.keys(synthesized).length > 0) passthrough.synthesized = synthesized;
  }
  if (entry.pvAlias && typeof ir.pv === 'string' && ir.pvName === undefined) {
    // Read into `pvName`; remember the key so a save writes `pv` again
    // (and keep the generic pass-through from leaving a second copy).
    delete props.pv;
    passthrough.renamed = { pvName: 'pv' };
  }

  const result: MapResult = {
    sbType: entry.sbType,
    props,
    actions,
    droppedProps: [],
    degradeReason: entry.degradeReason,
  };
  if (Object.keys(passthrough).length > 0) result.ir = passthrough;
  return result;
}

function sameShallow(a: WidgetProps, b: WidgetProps): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

/**
 * How a save re-emits an imported alias type (see `TypeMapEntry.alias`), or
 * `undefined` when `irType` is not one. Read by `exportScreenJSON.ts`.
 */
export function aliasExport(
  irType: string
): { sbType: WidgetType; renames: Readonly<Record<string, string>> } | undefined {
  const entry = Object.hasOwn(TYPE_MAP, irType) ? TYPE_MAP[irType] : undefined;
  return entry?.alias ? { sbType: entry.sbType, renames: entry.alias.renames } : undefined;
}

/** Whether the builder has a mapping for `irType` (anything else imports as a placeholder). */
export function isKnownIRType(irType: string): boolean {
  return irType !== 'unknown-widget' && Object.hasOwn(TYPE_MAP, irType);
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
    // The whole node is opaque to the builder: keep its type and props as
    // they came, and mark everything the placeholder shows as invented.
    ir: { type: node.type, props: { ...ir }, synthesized: { ...props } },
  };
}
