// Export the Screen Builder's internal `ScreenModel` to a canonical screen IR
// document (`*.screen.json`).
//
// Pure: `ScreenModel` in, `ScreenJSON` out, no I/O, no React, no store. This is
// the inverse of `../import/importScreenJSON.ts` + `../import/irWidgetMap.ts` —
// every rename/consumption table there has a mirror-image table here.
//
// ── Normalization contract ───────────────────────────────────────────────────
// The FIRST save of any screen canonicalizes it, even with no edits:
//  - Converter-flavored container types (`frame` / `group-box` / `scroll-area`
//    / `tabs`) all degrade to SB `Group` on import, so they all re-emit as the
//    single canonical `'group'` IR type — the original chrome distinction is
//    gone for good the moment the screen opens in SB.
//  - `related-display-button` is a first-class widget (`PVRelatedDisplayButton`)
//    that round-trips as `related-display-button` with `file`/`macros`/`target`
//    on `props` — no synthesized action.
//  - An `unknown-widget` placeholder imports as a `Rectangle` carrying
//    `originalClass`/`originalProps` as plain props; it re-emits as a plain
//    `'rectangle'`, keeping those props verbatim (no special-casing on
//    export — they ride through like any other prop). Its converter-stamped
//    node-level `warnings` ride on `Widget.warnings` — like every other
//    type — and re-emit at the node level, not as a prop.
//  - Prop keys within each node (and the root) are emitted ALPHABETICALLY
//    SORTED, regardless of insertion order.
//  - Sibling arrays (root children, and each container's children) are
//    ordered by `zIndex` ascending — NOT by whatever order they appear in the
//    model's `children`/`rootWidgetIds` lists.
//  - Absolute `zIndex` values are never stored in the IR — only the resulting
//    array order is. Re-importing renumbers from scratch (see
//    `importScreenJSON.ts`'s `zCounter`), so re-exporting the same screen
//    again yields the same order but not necessarily the same absolute
//    numbers — this is fine, order is the only observable contract.
//
// ── Reserved carrier props ───────────────────────────────────────────────────
// Several `Widget` fields have no IR field of their own. Rather than lose
// them, they're written into the node's `props` bag under reserved names that
// `importScreenJSON.ts` lifts back out on the way in:
//   `name`, `actions`, `visible`, `rotation`, `locked`.
// A hand-authored IR document that happens to use one of these prop names on
// a widget that doesn't otherwise need it will have that prop reinterpreted
// as the carrier on import — this is the documented tradeoff of piggybacking
// on the open `props` bag rather than extending the schema.
//
// Symmetrically, several `ScreenMeta` fields are SB-only canvas/editor
// presentation state with no IR field (`backgroundColor`, `gridSize`,
// `showGrid`, `snapToGrid`, `version`, `theme`,
// `showHorizontalScrollbar`/`showVerticalScrollbar`) — these are stashed as
// plain props on the synthetic `root` node (`type: 'absolute-canvas'`), which
// no real converter ever emits props on, so there's no collision risk in
// practice.

import { SCHEMA_VERSION, validate } from '@slaclab/canopy-screen-ir';
import type { ScreenJSON } from '@slaclab/canopy-screen-ir';
import type { Rule, ScreenModel, Widget, WidgetType } from '../../types/widget';

/** Thrown when the assembled document fails `@slaclab/canopy-screen-ir`'s `validate()`. */
export class ExportError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Screen export failed:\n${errors.join('\n')}`);
    this.name = 'ExportError';
    this.errors = errors;
  }
}

export interface ExportOptions {
  /** Injectable timestamp for deterministic output (tests). Defaults to `new Date().toISOString()`. */
  savedAt?: string;
  /**
   * Derive the document id fresh from the title, ignoring `meta.screenId` —
   * Save As semantics: a forked copy gets its own identity instead of
   * inheriting (and colliding with) the original's id.
   */
  freshId?: boolean;
}

/**
 * Slugify a screen title into a fallback IR document id: lowercase, collapse
 * runs of non-`[a-z0-9]` into a single `-`, trim leading/trailing `-`, and
 * fall back to `'screen'` if nothing alphanumeric survives.
 */
export function screenIdFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'screen' : slug;
}

// ── Prop bag helpers ─────────────────────────────────────────────────────────

type PropBag = Record<string, unknown>;

/** Assign `bag[key] = value` only when `value !== undefined` (never emit an explicit `undefined`). */
function put(bag: PropBag, key: string, value: unknown): void {
  if (value !== undefined) bag[key] = value;
}

/**
 * Rebuild an object with its own-enumerable keys sorted alphabetically.
 * Nested VALUES are copied by reference (verbatim) — this only reorders the
 * top-level keys of `obj` itself, it does not recursively re-sort nested
 * maps/arrays (e.g. a `macros` prop's own keys, or `originalProps`).
 */
function sortKeys<T extends PropBag>(obj: T): T {
  const sorted: PropBag = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return sorted as T;
}

/** Stable sort of widget ids by their `zIndex` (ascending), missing ids filtered out. */
function orderByZIndex(ids: readonly string[], widgets: Record<string, Widget>): string[] {
  return ids
    .filter((id) => id in widgets)
    .map((id, originalIndex) => ({ id, originalIndex, zIndex: widgets[id].zIndex }))
    .sort((a, b) => a.zIndex - b.zIndex || a.originalIndex - b.originalIndex)
    .map((entry) => entry.id);
}

// ── Per-type prop renamers ───────────────────────────────────────────────────
// The exact inverse of `../import/irWidgetMap.ts`'s `TYPE_MAP`: SB prop key →
// IR prop key. Every SB prop NOT named in a given type's rename table passes
// through verbatim under its own key (skipping `undefined` values). If a
// rename's target key ALSO exists as a literal prop already, the renamed
// value wins and the literal is skipped — this mirrors import's `!(key in
// props)` guard in reverse: the deliberate rename always takes priority over
// an incidental same-named passthrough prop.

interface TypeExport {
  irType: (widget: Widget) => string;
  /** SB prop key → IR prop key. */
  renames: Readonly<Record<string, string>>;
}

const NO_RENAMES: Readonly<Record<string, string>> = {};

/** `pvName` → `pv` — the common case shared by most PV-bound widget types. */
const PV_NAME_RENAME: Readonly<Record<string, string>> = { pvName: 'pv' };

const TYPE_EXPORT_TABLE: Record<WidgetType, TypeExport> = {
  StaticLabel: { irType: () => 'text-label', renames: NO_RENAMES },
  PVTextDisplay: { irType: () => 'pv-label', renames: PV_NAME_RENAME },
  PVTextInput: { irType: () => 'pv-text-input', renames: PV_NAME_RENAME },
  PVButton: {
    irType: (w) => (w.props.pvName !== undefined ? 'pv-button' : 'regular-button'),
    renames: PV_NAME_RENAME,
  },
  PVShellCommand: {
    irType: () => 'shell-command-button',
    renames: {
      alarmSensitiveContent: 'alarmSensitive',
      alarmSensitiveBorder: 'alarmBorder',
    },
  },
  PVWaveformPlot: { irType: () => 'waveform-plot', renames: NO_RENAMES },
  PVCheckbox: { irType: () => 'pv-checkbox', renames: PV_NAME_RENAME },
  PVDropdown: { irType: () => 'pv-enum-combobox', renames: PV_NAME_RENAME },
  PVSlider: {
    irType: () => 'pv-slider',
    renames: {
      pvName: 'pv',
      minValue: 'min',
      maxValue: 'max',
      showValueLabel: 'showValue',
    },
  },
  PVProgressBar: {
    irType: () => 'pv-progress-bar',
    renames: { pvName: 'pv', minValue: 'min', maxValue: 'max' },
  },
  PVByteIndicator: {
    irType: () => 'pv-byte-led',
    renames: { pvName: 'pv', startBit: 'shift' },
  },
  PVLed: { irType: () => 'pv-led', renames: PV_NAME_RENAME },
  PVMeter: {
    irType: () => 'pv-meter',
    renames: {
      pvName: 'pv',
      minValue: 'min',
      maxValue: 'max',
      showValueLabel: 'showValue',
    },
  },
  PVRadioGroup: {
    irType: () => 'pv-radio-group',
    renames: { pvName: 'pv', alarmSensitiveBorder: 'alarmSensitive' },
  },
  EmbeddedScreen: { irType: () => 'embedded-display', renames: NO_RENAMES },
  Image: {
    // `mode: 'live'` emits `pv-image-view`; anything else emits the plain
    // `image-view` type — one widget, two IR flavors picked by mode.
    irType: (w) => (w.props.mode === 'live' ? 'pv-image-view' : 'image-view'),
    renames: { pvName: 'pv' },
  },
  // Identity-imported types (see `irWidgetMap.ts`'s "Identity entries" section)
  // — verbatim, no renames. For the pv-flavored ones the model key `pvName`
  // stays `pvName` on export (NOT renamed to `pv`); import's tolerance for a
  // hand-authored `pv` key is one-directional.
  Group: { irType: () => 'group', renames: NO_RENAMES },
  Rectangle: { irType: () => 'rectangle', renames: NO_RENAMES },
  Ellipse: { irType: () => 'ellipse', renames: NO_RENAMES },
  Arc: { irType: () => 'arc', renames: NO_RENAMES },
  Line: { irType: () => 'line', renames: NO_RENAMES },
  Polygon: { irType: () => 'polygon', renames: NO_RENAMES },
  PVToggle: { irType: () => 'pv-toggle', renames: NO_RENAMES },
  PVSpinbox: { irType: () => 'pv-spinbox', renames: NO_RENAMES },
  PVTabs: { irType: () => 'pv-tabs', renames: NO_RENAMES },
  PVGauge: { irType: () => 'pv-gauge', renames: NO_RENAMES },
  PVTank: { irType: () => 'pv-tank', renames: NO_RENAMES },
  PVThermometer: { irType: () => 'pv-thermometer', renames: NO_RENAMES },
  PVRelatedDisplayButton: { irType: () => 'related-display-button', renames: NO_RENAMES },
  PVSymbol: { irType: () => 'pv-symbol', renames: { pvName: 'pv' } },
  PVTimePlot: { irType: () => 'pv-time-plot', renames: { pvName: 'pv' } },
  PVScatterPlot: {
    irType: () => 'pv-scatter-plot',
    renames: { pvNameX: 'xPv', pvNameY: 'yPv' },
  },
};

/**
 * Build the IR `type` + renamed props bag for one widget — the inverse of
 * `irWidgetMap.ts`'s per-type mapper. Carrier props are appended by the
 * caller afterward; this only handles the rename table + verbatim
 * pass-through.
 */
function exportTypeAndProps(widget: Widget): { irType: string; props: PropBag } {
  const entry = TYPE_EXPORT_TABLE[widget.type];
  const irType = entry.irType(widget);
  const props: PropBag = {};

  // Renamed keys first, so a same-named literal prop (checked below) never
  // clobbers a deliberate rename.
  for (const [sbKey, irKey] of Object.entries(entry.renames)) {
    if (widget.props[sbKey] !== undefined) put(props, irKey, widget.props[sbKey]);
  }

  // Verbatim pass-through: every prop not itself a rename SOURCE, and not
  // already written as a rename TARGET (the "renamed value wins" rule).
  const renameSources = new Set(Object.keys(entry.renames));
  for (const [key, value] of Object.entries(widget.props)) {
    if (renameSources.has(key)) continue;
    if (key in props) continue;
    put(props, key, value);
  }

  return { irType, props };
}

// ── Carrier props ────────────────────────────────────────────────────────────

/** Append the reserved carrier props (see header comment) onto a props bag. */
function addCarrierProps(props: PropBag, widget: Widget): void {
  props.name = widget.name;
  if (widget.actions.length > 0) props.actions = deepClone(widget.actions);
  if (widget.visible === false) props.visible = false;
  if (
    typeof widget.rotation === 'number' &&
    Number.isFinite(widget.rotation) &&
    widget.rotation !== 0
  ) {
    props.rotation = widget.rotation;
  }
  if (widget.locked === true) props.locked = true;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Rules ────────────────────────────────────────────────────────────────────

type RuleScalar = string | number | boolean | null;

function isRuleScalar(value: unknown): value is RuleScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** Build one IR conditional rule arm from an SB `Rule` — the inverse of `mapRules` in `importScreenJSON.ts`. */
function exportRule(rule: Rule, widget: Widget, index: number): PropBag {
  if (rule.outputExpression === true) {
    throw new ExportError([
      `widget '${widget.id}' rule '${rule.name}' has no IR representation for output-expression rules`,
    ]);
  }

  const expressions = rule.expressions;
  const last = expressions.at(-1);
  const hasTrailingCatchAll = last !== undefined && last.condition === 'true';

  const defaultValue: unknown = hasTrailingCatchAll ? last.value : null;
  const conditionExpressions = hasTrailingCatchAll ? expressions.slice(0, -1) : expressions;

  if (!isRuleScalar(defaultValue)) {
    throw new ExportError([
      `widget '${widget.id}' rule '${rule.name}' default value is not a JSON scalar`,
    ]);
  }

  const conditions = conditionExpressions.map((expr) => {
    if (!isRuleScalar(expr.value)) {
      throw new ExportError([
        `widget '${widget.id}' rule '${rule.name}' condition value is not a JSON scalar`,
      ]);
    }
    return { expression: expr.condition, value: expr.value };
  });

  return {
    id: rule.id ?? `r-${widget.id}-${index + 1}`,
    name: rule.name,
    targetProperty: rule.targetProperty,
    default: defaultValue,
    pvs: rule.pvs.map((pv) => ({ name: pv.name, trigger: pv.trigger })),
    conditions,
  };
}

// ── Widget node assembly ─────────────────────────────────────────────────────

function buildWidgetNode(widget: Widget, widgets: Record<string, Widget>): PropBag {
  const { irType, props } = exportTypeAndProps(widget);
  addCarrierProps(props, widget);

  const node: PropBag = {
    id: widget.id,
    type: irType,
    props: sortKeys(props),
    geometry: {
      x: widget.layout.x,
      y: widget.layout.y,
      width: widget.layout.width,
      height: widget.layout.height,
    },
  };

  const childIds = orderByZIndex(widget.children ?? [], widgets);
  if (childIds.length > 0) {
    node.children = childIds.map((id) => buildWidgetNode(widgets[id], widgets));
  }

  if (widget.rules.length > 0) {
    node.rules = widget.rules.map((rule, index) => exportRule(rule, widget, index));
  }

  const comment = widget.meta?.comment;
  if (typeof comment === 'string' && comment !== '') {
    node.meta = { comment };
  }

  if (widget.warnings && widget.warnings.length > 0) {
    node.warnings = [...widget.warnings];
  }

  return node;
}

// ── Root node assembly ───────────────────────────────────────────────────────

function buildRootNode(screen: ScreenModel): PropBag {
  const { meta, widgets, rootWidgetIds } = screen;

  const rootProps: PropBag = {
    width: meta.width,
    height: meta.height,
    gridSize: meta.gridSize,
    showGrid: meta.showGrid,
    snapToGrid: meta.snapToGrid,
    version: meta.version,
  };
  // Only emit backgroundColor when the screen pins one; empty/unset means
  // "follow the theme" and shouldn't round-trip as an explicit value.
  put(rootProps, 'backgroundColor', meta.backgroundColor);
  put(rootProps, 'theme', meta.theme);
  put(rootProps, 'showHorizontalScrollbar', meta.showHorizontalScrollbar);
  put(rootProps, 'showVerticalScrollbar', meta.showVerticalScrollbar);

  const childIds = orderByZIndex(rootWidgetIds, widgets);

  return {
    id: 'root',
    type: 'absolute-canvas',
    props: sortKeys(rootProps),
    geometry: { x: 0, y: 0, width: meta.width, height: meta.height },
    children: childIds.map((id) => buildWidgetNode(widgets[id], widgets)),
  };
}

// ── Document assembly ────────────────────────────────────────────────────────

/**
 * Convert a `ScreenModel` to a screen IR document.
 *
 * Assembles the document, round-trips it through `JSON.parse(JSON.stringify(...))`
 * (guaranteeing the returned/validated value is exactly what will be written —
 * this also converts `NaN`/`Infinity` to `null` so the schema rejects them
 * loudly rather than silently), then validates against the full Screen IR
 * contract. Throws `ExportError` (carrying the messages) on any failure.
 */
export function exportScreenJSON(screen: ScreenModel, opts?: ExportOptions): ScreenJSON {
  const { meta } = screen;

  const macros = Object.entries(meta.macros).map(([name, value]) => {
    const macro: PropBag = { name };
    if (meta.screenKind !== 'template') macro.default = value;
    const description = meta.macroDescriptions?.[name];
    if (description !== undefined) macro.description = description;
    return macro;
  });

  const metadata: PropBag = {
    title: meta.title,
    source: { type: 'screen-builder', savedAt: opts?.savedAt ?? new Date().toISOString() },
    size: { width: meta.width, height: meta.height },
  };
  if (typeof meta.description === 'string' && meta.description !== '') {
    metadata.description = meta.description;
  }
  if (typeof meta.author === 'string' && meta.author !== '') {
    metadata.author = meta.author;
  }

  const doc: PropBag = {
    schemaVersion: SCHEMA_VERSION,
    kind: meta.screenKind ?? 'screen',
    id: (opts?.freshId ? undefined : meta.screenId) ?? screenIdFromTitle(meta.title),
    metadata,
    macros,
  };
  if (meta.formulas && meta.formulas.length > 0) doc.formulas = deepClone(meta.formulas);
  doc.root = buildRootNode(screen);

  const plain = JSON.parse(JSON.stringify(doc)) as unknown;
  const errors = validate(plain);
  if (errors.length > 0) throw new ExportError(errors);
  return plain as ScreenJSON;
}

/** Serialize an already-exported document: 2-space indent, trailing newline. */
export function serializeScreenDoc(doc: ScreenJSON): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Serialize a `ScreenModel` straight to a `.screen.json` string: 2-space indent, trailing newline. */
export function serializeScreenJSON(screen: ScreenModel, opts?: ExportOptions): string {
  return serializeScreenDoc(exportScreenJSON(screen, opts));
}
