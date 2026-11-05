import type { FormulaDeclaration } from '@slaclab/canopy-screen-ir';

// ── Alarm ──────────────────────────────────���───────────────���─────────────────

export const AlarmSeverity = {
  NO_ALARM: 0,
  MINOR: 1,
  MAJOR: 2,
  INVALID: 3,
  DISCONNECTED: 4,
} as const;
export type AlarmSeverity = (typeof AlarmSeverity)[keyof typeof AlarmSeverity];

export const AlarmSeverityName: Record<AlarmSeverity, string> = Object.fromEntries(
  Object.entries(AlarmSeverity).map(([name, value]) => [value, name])
) as Record<AlarmSeverity, string>;

// ── Display Format ──────────────────────────────���────────────────────────────

export const DisplayFormat = {
  Default: 'default',
  Decimal: 'decimal',
  Exponential: 'exponential',
  Hex: 'hex',
  Binary: 'binary',
  String: 'string',
  Engineering: 'engineering',
} as const;
export type DisplayFormat = (typeof DisplayFormat)[keyof typeof DisplayFormat];

// ── Rules & Actions ──────────────────────────────────────────────────────────

export interface RuleExpression {
  condition: string;
  value: unknown;
}

export interface RulePV {
  name: string;
  trigger: boolean;
}

export interface Rule {
  /**
   * The canonical IR rule id. Preserved verbatim through import so save
   * re-emits it unchanged; minted deterministically on export when absent.
   */
  id?: string;
  name: string;
  targetProperty: string;
  outputExpression: boolean;
  expressions: RuleExpression[];
  pvs: RulePV[];
}

export type Action =
  | {
      type: 'open_display';
      file: string;
      macros?: Record<string, string>;
      target: 'tab' | 'window' | 'replace';
    }
  | { type: 'write_pv'; pvName: string; value: string | number }
  | { type: 'execute'; command: string; description?: string }
  | { type: 'open_webpage'; url: string }
  | { type: 'open_file'; file: string };

// ── Layout ────────────────────────────────────────────────────────────────���──

export type LayoutMode = 'absolute' | 'flex' | 'grid';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface AbsoluteLayout extends Position, Size {}

// ── Widget Catalog ───────────────────────────────────────────────────────────
// Single source of truth for widget types and how they are imported in
// generated TSX. Both parseTSX (recognising tags) and generateTSX (emitting
// imports) read from here, so adding a widget is a one-line change.

export const WIDGET_CATALOG = {
  pvWrappers: [
    'PVTextDisplay',
    'PVTextInput',
    'PVButton',
    'PVShellCommand',
    'PVDropdown',
    'PVCheckbox',
    'PVRadioGroup',
    'PVSlider',
    'PVSpinbox',
    'PVToggle',
    'PVProgressBar',
    'PVTabs',
  ],
  indicators: ['PVLed', 'PVByteIndicator', 'PVMeter', 'PVGauge', 'PVTank', 'PVThermometer'],
  charts: ['PVWaveformPlot'],
  drawings: ['Rectangle', 'Ellipse', 'Line', 'Arc', 'Polygon', 'StaticLabel', 'ScreenImage'],
  containers: ['Group', 'EmbeddedScreen'],
} as const;

export type WidgetType = (typeof WIDGET_CATALOG)[keyof typeof WIDGET_CATALOG][number];

export const ALL_WIDGET_TYPES: readonly WidgetType[] = [
  ...WIDGET_CATALOG.pvWrappers,
  ...WIDGET_CATALOG.indicators,
  ...WIDGET_CATALOG.charts,
  ...WIDGET_CATALOG.drawings,
  ...WIDGET_CATALOG.containers,
];

// ── Widget Model ────────────────────────────────���────────────────────────────

export interface WidgetProps {
  // PV binding
  pvName?: string;
  pvBindings?: Record<string, string>;

  // Display
  label?: string;
  format?: DisplayFormat;
  precision?: number;
  precisionFromPV?: boolean;
  showUnits?: boolean;

  // Appearance
  foregroundColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number;

  // Alarm
  alarmSensitiveBorder?: boolean;
  alarmSensitiveContent?: boolean;

  // Write widgets
  confirmOnWrite?: boolean;
  confirmMessage?: string;
  minValue?: number;
  maxValue?: number;
  limitsFromPV?: boolean;
  enabled?: boolean;

  // Button-specific
  pressValue?: string | number;
  releaseValue?: string | number;
  onLabel?: string;
  offLabel?: string;
  onColor?: string;
  offColor?: string;
  bit?: number;

  // Slider-specific
  orientation?: 'horizontal' | 'vertical';
  showScale?: boolean;
  showValueLabel?: boolean;
  increment?: number;

  // Shape-specific
  lineColor?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fill?: boolean;
  cornerRadius?: number;
  startAngle?: number;
  spanAngle?: number;

  // Image
  filename?: string;
  stretchMode?: 'none' | 'fit' | 'fill' | 'stretch';

  // Embedded display
  file?: string;
  macros?: Record<string, string>;
  resizeMode?: 'none' | 'resize' | 'sizeToContent' | 'stretch' | 'crop';

  // LED
  numBits?: number;
  startBit?: number;
  bigEndian?: boolean;

  // Container layout
  layoutMode?: LayoutMode;
  gap?: number;
  flexDirection?: 'row' | 'column';
  alignItems?: string;
  justifyContent?: string;

  // Text
  text?: string;

  // Allow arbitrary extra props
  [key: string]: unknown;
}

export interface Widget {
  id: string;
  type: WidgetType;
  name: string;
  layout: AbsoluteLayout;
  visible: boolean;
  rotation: number;
  rules: Rule[];
  actions: Action[];
  props: WidgetProps;
  children?: string[]; // child widget IDs for containers
  parentId?: string;
  locked?: boolean;
  zIndex: number;
  /**
   * IR `WidgetNode.meta` passthrough (operator notes like "DO NOT MOVE").
   * Survives save/open round trips; not editable in the UI yet.
   */
  meta?: { comment?: string };
  /**
   * IR `WidgetNode.warnings` passthrough (converter-stamped notes, e.g.
   * degrade details). Survives save/open round trips; also echoed into the
   * import report each time the document is opened.
   */
  warnings?: string[];
}

// ── Screen Model ──────────────────��──────────────────────────────────────────

export interface ScreenMeta {
  title: string;
  width: number;
  height: number;
  /** Empty/unset means "follow the app theme" — Canvas / LivePreview fall
   *  back to `--cds-background` via CSS. Explicit hex colors pin the bg. */
  backgroundColor?: string;
  macros: Record<string, string>;
  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
  version: string;
  theme?: 'white' | 'g10' | 'g90' | 'g100';
  /**
   * Screen-level formula declarations (the canonical IR `formulas[]`),
   * referenced by `formula://<name>` from channel props and rules. Author-facing
   * and round-tripped through eject; omitted when the screen has none.
   */
  formulas?: FormulaDeclaration[];
  showHorizontalScrollbar?: boolean;
  showVerticalScrollbar?: boolean;
  /** IR passthrough (document `id`) so saves round-trip. */
  screenId?: string;
  /** IR passthrough (`kind`) so saves round-trip. */
  screenKind?: 'screen' | 'template';
  /** IR passthrough (`metadata.description`) so saves round-trip. */
  description?: string;
  /** IR passthrough (`metadata.author`) so saves round-trip. */
  author?: string;
  /** IR passthrough (`macros[].description`, keyed by macro name) so saves round-trip. */
  macroDescriptions?: Record<string, string>;
}

export interface ScreenModel {
  meta: ScreenMeta;
  widgets: Record<string, Widget>;
  rootWidgetIds: string[];
  tabOrder: string[];
}

export function createDefaultScreenMeta(): ScreenMeta {
  // theme and backgroundColor are intentionally omitted: new screens follow
  // the app's Carbon light/dark theme. Setting either here would pin new
  // screens to a fixed theme and defeat the point.
  return {
    title: 'New Screen',
    width: 800,
    height: 600,
    macros: {},
    gridSize: 10,
    showGrid: true,
    snapToGrid: true,
    version: '1.0.0',
    showHorizontalScrollbar: true,
    showVerticalScrollbar: true,
  };
}

export function createDefaultScreen(): ScreenModel {
  return {
    meta: createDefaultScreenMeta(),
    widgets: {},
    rootWidgetIds: [],
    tabOrder: [],
  };
}
