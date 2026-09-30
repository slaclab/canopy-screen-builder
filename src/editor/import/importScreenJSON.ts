// Import a canonical screen IR document (`*.screen.json`) into the Screen
// Builder's internal `ScreenModel`.
//
// Pure: JSON in, `{ screen, report }` out, no I/O. Shared by both entry points —
// opening a saved `.screen.json` locally, and the live `.ui`/`.edl` converter
// flow (which feeds in the DTO's `screen` field).
//
// The core transform is **tree → flat map**: the IR nests widgets via
// `root.children` with absolute geometry and array-order z-order; the SB stores
// a flat `widgets` record keyed by id with a `rootWidgetIds` list.
//
// The reverse direction — `ScreenModel` → IR document — lives in
// `../export/exportScreenJSON.ts` and inverts the tables in `./irWidgetMap.ts`.

import { validate, SCHEMA_VERSION } from '@slaclab/canopy-screen-ir';
import type { ScreenJSON, WidgetNode, Rule as IRRule } from '@slaclab/canopy-screen-ir';
import type {
  Action,
  Rule,
  RuleExpression,
  ScreenModel,
  ScreenMeta,
  Widget,
  WidgetProps,
} from '../../types/widget';
import { createDefaultScreenMeta } from '../../types/widget';
import { mapWidget } from './irWidgetMap';

/** Thrown when the input document fails `@slaclab/canopy-screen-ir`'s `validate()`. */
export class ImportValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Screen IR validation failed:\n${errors.join('\n')}`);
    this.name = 'ImportValidationError';
    this.errors = errors;
  }
}

/** Everything the import touched that the user should know about. */
export interface ImportReport {
  /** D11 placeholders, aggregated by original Qt class. */
  unknownWidgets: { originalClass: string; count: number }[];
  /** Widgets imported with reduced fidelity (chrome/semantics lost). */
  degradedWidgets: { widgetId: string; type: string; reason: string }[];
  /** IR prop keys discarded with no SB home. */
  droppedProps: { widgetId: string; type: string; keys: string[] }[];
  /** Rules dropped on import. Always empty today; kept for the report's consumers. */
  droppedRules: string[];
  /**
   * Formula-driven rules: no SB equivalent yet, so not editable, but carried
   * on the widget and written back unchanged on save.
   */
  keptRules: string[];
  /** Node warnings + soft import notes (e.g. duplicate-id renames). */
  warnings: string[];
}

function emptyReport(): ImportReport {
  return {
    unknownWidgets: [],
    degradedWidgets: [],
    droppedProps: [],
    droppedRules: [],
    keptRules: [],
    warnings: [],
  };
}

/**
 * Convert a screen IR document to a `ScreenModel` + an `ImportReport`.
 *
 * Validates against the full Screen IR contract first; throws
 * `ImportValidationError` (carrying the messages) on any failure, so the caller
 * never replaces the canvas with a half-imported screen.
 */
export function importScreenJSON(json: unknown): { screen: ScreenModel; report: ImportReport } {
  // Read-tolerance: the converter omits `macros` entirely on a screen with no
  // macros, but the canonical schema requires the key (an absent array and `[]`
  // are semantically identical). Normalize before validating rather than
  // weakening the shared contract. Other absent-but-defaultable fields stay the
  // schema's concern.
  const normalized = normalizeForRead(json);

  const errors = validate(normalized);
  if (errors.length > 0) throw new ImportValidationError(errors);

  const doc = normalized as ScreenJSON;
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    throw new ImportValidationError([
      `unsupported schemaVersion '${doc.schemaVersion}', expected '${SCHEMA_VERSION}'`,
    ]);
  }

  const report = emptyReport();
  const meta = buildMeta(doc);

  const widgets: Record<string, Widget> = {};
  const rootWidgetIds: string[] = [];
  const unknownCounts = new Map<string, number>();
  let zCounter = 0;
  const usedIds = new Set<string>();

  // Stable id reuse: the IR's `w-NNN` ids are meaningful (rules/refs point at
  // them), so reuse them verbatim. Only synthesize on the rare collision.
  const claimId = (rawId: string): string => {
    let id = rawId;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${rawId}-${n++}`;
      report.warnings.push(`duplicate widget id '${rawId}' renamed to '${id}'`);
    }
    usedIds.add(id);
    return id;
  };

  const walk = (node: WidgetNode, parentId: string | undefined): string => {
    const id = claimId(node.id);
    const mapped = mapWidget(node);

    if (mapped.unknown) {
      const oc = mapped.unknown.originalClass;
      unknownCounts.set(oc, (unknownCounts.get(oc) ?? 0) + 1);
    } else if (mapped.degradeReason) {
      report.degradedWidgets.push({ widgetId: id, type: node.type, reason: mapped.degradeReason });
    }
    if (mapped.droppedProps.length > 0) {
      report.droppedProps.push({ widgetId: id, type: node.type, keys: mapped.droppedProps });
    }
    if (node.warnings?.length) report.warnings.push(...node.warnings);

    const childIds = (node.children ?? []).map((child) => walk(child, id));

    // Reserved carrier props: skip all lifting for unknown-widget placeholders
    // (their props ARE the preserved original Qt props, not exporter carriers).
    const carriers = mapped.unknown ? undefined : liftCarrierProps(mapped.props, id, report);

    const rules = mapRules(node.rules, id, report);
    const ir = mapped.ir ?? {};
    if (rules.kept.length > 0) ir.rules = rules.kept;

    const widget: Widget = {
      id,
      type: mapped.sbType,
      name: carriers?.name ?? defaultWidgetName(mapped.sbType, id),
      layout: {
        x: node.geometry.x,
        y: node.geometry.y,
        width: node.geometry.width,
        height: node.geometry.height,
      },
      visible: carriers?.visible ?? true,
      rotation: carriers?.rotation ?? 0,
      rules: rules.mapped,
      actions: [...mapped.actions, ...(carriers?.actions ?? [])],
      props: mapped.props,
      zIndex: zCounter++,
    };
    if (parentId) widget.parentId = parentId;
    if (childIds.length > 0) widget.children = childIds;
    if (carriers?.locked) widget.locked = true;

    const comment = node.meta?.comment;
    if (typeof comment === 'string' && comment !== '') widget.meta = { comment };

    // Node-level warnings are durable IR data (unlike the report, which is a
    // one-time import summary): carry them so a save re-emits them node-level.
    if (node.warnings?.length) widget.warnings = [...node.warnings];

    if (Object.keys(ir).length > 0) widget.ir = ir;

    widgets[id] = widget;
    return id;
  };

  // The `absolute-canvas` root is a structural wrapper, not a user widget — its
  // size already fed `meta`; only its children become real widgets.
  for (const child of doc.root.children ?? []) {
    rootWidgetIds.push(walk(child, undefined));
  }

  report.unknownWidgets = [...unknownCounts].map(([originalClass, count]) => ({
    originalClass,
    count,
  }));

  const screen: ScreenModel = {
    meta,
    widgets,
    rootWidgetIds,
    tabOrder: [...rootWidgetIds],
  };
  return { screen, report };
}

/**
 * Default absent-but-empty-equivalent fields so valid-in-spirit converter
 * output passes the schema gate. Currently just `macros: []` (the converter
 * omits it when empty). Non-object input is returned untouched for `validate()`
 * to reject with a precise message.
 */
/**
 * The name a widget gets when the document carries none. A save leaves a
 * name out while it still equals this, so opening and saving a converted
 * screen does not stamp a `name` prop on every node.
 */
export function defaultWidgetName(sbType: string, id: string): string {
  return `${sbType}_${id}`;
}

function normalizeForRead(json: unknown): unknown {
  if (!json || typeof json !== 'object') return json;
  const obj = json as Record<string, unknown>;
  if (obj.macros === undefined) return { ...obj, macros: [] };
  return json;
}

/**
 * Build `ScreenMeta` from the document's `metadata`/`macros`/`formulas`, plus
 * IR passthrough fields (`id`, `kind`, `metadata.description/author`,
 * `macros[].description`) so a save re-emits them unchanged. Also lifts
 * EDITOR PRESENTATION props the exporter stashes on `root.props` (the
 * converters never emit these — they're SB-only canvas chrome) with strict
 * type guards; anything malformed is silently ignored rather than imported.
 */
function buildMeta(doc: ScreenJSON): ScreenMeta {
  const meta = createDefaultScreenMeta();
  meta.title = doc.metadata.title;
  meta.width = doc.metadata.size.width;
  meta.height = doc.metadata.size.height;
  meta.macros = Object.fromEntries((doc.macros ?? []).map((m) => [m.name, m.default ?? '']));
  // Lossless: screen-level formulas are author-facing and survive eject.
  if (doc.formulas && doc.formulas.length > 0) meta.formulas = [...doc.formulas];

  meta.screenId = doc.id;
  meta.screenKind = doc.kind;
  if (doc.metadata.description !== undefined) meta.description = doc.metadata.description;
  if (doc.metadata.author !== undefined) meta.author = doc.metadata.author;
  const macroDescriptions = Object.fromEntries(
    (doc.macros ?? [])
      .filter((m) => m.description !== undefined)
      .map((m) => [m.name, m.description as string])
  );
  if (Object.keys(macroDescriptions).length > 0) meta.macroDescriptions = macroDescriptions;

  const rootProps = (doc.root.props ?? {}) as Record<string, unknown>;
  // Root prop keys that landed on `meta`; whatever is left over (an unknown
  // key, or a known one with a malformed value) is carried verbatim.
  const lifted = new Set<string>(['width', 'height']);
  if (typeof rootProps.backgroundColor === 'string') {
    meta.backgroundColor = rootProps.backgroundColor;
    lifted.add('backgroundColor');
  }
  if (typeof rootProps.gridSize === 'number') {
    meta.gridSize = rootProps.gridSize;
    lifted.add('gridSize');
  }
  if (typeof rootProps.showGrid === 'boolean') {
    meta.showGrid = rootProps.showGrid;
    lifted.add('showGrid');
  }
  if (typeof rootProps.snapToGrid === 'boolean') {
    meta.snapToGrid = rootProps.snapToGrid;
    lifted.add('snapToGrid');
  }
  if (typeof rootProps.version === 'string') {
    meta.version = rootProps.version;
    lifted.add('version');
  }
  if (
    rootProps.theme === 'white' ||
    rootProps.theme === 'g10' ||
    rootProps.theme === 'g90' ||
    rootProps.theme === 'g100'
  ) {
    meta.theme = rootProps.theme;
    lifted.add('theme');
  }
  if (typeof rootProps.showHorizontalScrollbar === 'boolean') {
    meta.showHorizontalScrollbar = rootProps.showHorizontalScrollbar;
    lifted.add('showHorizontalScrollbar');
  }
  if (typeof rootProps.showVerticalScrollbar === 'boolean') {
    meta.showVerticalScrollbar = rootProps.showVerticalScrollbar;
    lifted.add('showVerticalScrollbar');
  }
  const leftover = Object.fromEntries(Object.entries(rootProps).filter(([k]) => !lifted.has(k)));
  if (Object.keys(leftover).length > 0) meta.rootProps = leftover;

  // Root-node passthrough: the converter's root id (`w-001`, not `root`) and
  // the screen-level notes it stamps on the root node.
  if (doc.root.id !== 'root') meta.rootId = doc.root.id;
  if (doc.root.warnings?.length) meta.rootWarnings = [...doc.root.warnings];

  const provenance = provenanceOf(doc.metadata.source as Record<string, unknown>);
  if (Object.keys(provenance).length > 0) meta.provenance = provenance;

  return meta;
}

/**
 * What a save must keep of `metadata.source`. The builder stamps its own
 * `type` and `savedAt`, so those two go; a converter's `type` moves to
 * `origin` (unless an earlier save already recorded one) and every other key
 * (`sourceFile`, `convertedAt`, ...) is kept as it is.
 */
function provenanceOf(source: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...source };
  delete rest.type;
  delete rest.savedAt;
  if (source.type !== 'screen-builder' && rest.origin === undefined) rest.origin = source.type;
  return rest;
}

/**
 * Recognized SB `Action` type discriminators — used to validate a plain
 * `actions` prop before lifting it onto the widget as reserved carrier data.
 */
const KNOWN_ACTION_TYPES = new Set([
  'open_display',
  'write_pv',
  'execute',
  'open_webpage',
  'open_file',
]);

function isActionList(value: unknown): value is Action[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        v !== null &&
        typeof v === 'object' &&
        typeof (v as { type?: unknown }).type === 'string' &&
        KNOWN_ACTION_TYPES.has((v as { type: string }).type)
    )
  );
}

interface LiftedCarriers {
  name?: string;
  actions?: Action[];
  visible?: boolean;
  rotation?: number;
  locked?: boolean;
}

/**
 * Lift the reserved carrier props (`name`, `actions`, `visible`, `rotation`,
 * `locked`) out of a mapped widget's props bag onto the `Widget` itself —
 * the exact inverse of what `exportScreenJSON.ts` writes. Mutates `props` in
 * place (deleting lifted keys); malformed carriers are left as plain props
 * (with a warning for `actions`) rather than dropped.
 */
function liftCarrierProps(
  props: WidgetProps,
  widgetId: string,
  report: ImportReport
): LiftedCarriers {
  const lifted: LiftedCarriers = {};

  if (typeof props.name === 'string' && props.name !== '') {
    lifted.name = props.name;
    delete props.name;
  }

  if ('actions' in props) {
    if (isActionList(props.actions)) {
      lifted.actions = props.actions;
      delete props.actions;
    } else {
      report.warnings.push(
        `widget '${widgetId}' has an 'actions' prop that is not a recognized action list; kept as a plain prop`
      );
    }
  }

  if (typeof props.visible === 'boolean') {
    lifted.visible = props.visible;
    delete props.visible;
  }

  if (typeof props.rotation === 'number' && Number.isFinite(props.rotation)) {
    lifted.rotation = props.rotation;
    delete props.rotation;
  }

  if (props.locked === true) {
    lifted.locked = true;
    delete props.locked;
  } else if (props.locked === false) {
    delete props.locked;
  }

  return lifted;
}

/**
 * Map IR rules (a discriminated union) to SB rules (a single flat shape).
 *
 * - **Formula-driven** rules have no SB equivalent yet → not editable, but
 *   kept verbatim (with their position) for the exporter to write back, and
 *   reported.
 * - **Conditional** rules map `conditions[].expression` → `expressions[].condition`
 *   (note the field flip), and the IR `default` is folded into a trailing
 *   catch-all `{ condition: 'true', value: default }` so its semantics survive.
 * The IR `id` is kept verbatim on the SB rule (`Rule.id`) so a re-save re-emits
 * it unchanged; `pvs` map 1:1, leaving `fox://`/`${MACRO}` names literal.
 */
function mapRules(
  irRules: readonly IRRule[] | undefined,
  widgetId: string,
  report: ImportReport
): { mapped: Rule[]; kept: { index: number; rule: unknown }[] } {
  const rules: Rule[] = [];
  const kept: { index: number; rule: unknown }[] = [];
  for (const [index, ir] of (irRules ?? []).entries()) {
    if ('formula' in ir) {
      kept.push({ index, rule: ir });
      report.keptRules.push(`${ir.name} (formula-driven) on widget '${widgetId}'`);
      report.warnings.push(
        `rule '${ir.name}' on '${widgetId}' is formula-driven: kept as-is on save, but not editable (no SB support yet)`
      );
      continue;
    }
    const expressions: RuleExpression[] = ir.conditions.map((c) => ({
      condition: c.expression,
      value: c.value,
    }));
    expressions.push({ condition: 'true', value: ir.default });
    rules.push({
      id: ir.id,
      name: ir.name,
      targetProperty: ir.targetProperty,
      outputExpression: false,
      expressions,
      pvs: ir.pvs.map((pv) => ({ name: pv.name, trigger: pv.trigger })),
    });
  }
  return { mapped: rules, kept };
}
