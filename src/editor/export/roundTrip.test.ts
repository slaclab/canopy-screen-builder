import { describe, it, expect } from 'vitest';
import { validate } from '@slaclab/canopy-screen-ir';
import { importScreenJSON } from '../import/importScreenJSON';
import { exportScreenJSON, screenIdFromTitle, serializeScreenJSON } from './exportScreenJSON';
import { widgetRegistry } from '../../widgets/registry/WidgetRegistry';
import { registerBuiltinWidgets } from '../../widgets/registry/registerBuiltins';
import type { PropSchema, WidgetDefinition } from '../../widgets/registry/WidgetRegistry';
import type { Rule, ScreenMeta, ScreenModel, Widget, WidgetType } from '../../types/widget';
import { createDefaultScreenMeta } from '../../types/widget';

import simpleFixture from '../import/__fixtures__/simple.screen.json';
import p1WidgetsFixture from '../import/__fixtures__/p1_widgets.screen.json';
import formulaDrivenFixture from '../import/__fixtures__/formula-driven.screen.json';
import vacuumSystemFixture from '../import/__fixtures__/vacuum-system.screen.json';

const FIXED = '2026-07-06T00:00:00.000Z';

registerBuiltinWidgets();

// ── normalizeScreen ──────────────────────────────────────────────────────────
//
// A screen that has gone `export -> import` is allowed to differ from the
// pre-export screen in specific, well-understood ways that do NOT count as
// data loss — they're artifacts of the IR's canonical representation (array
// order instead of an absolute zIndex; ids minted at import time when the
// model didn't set one; etc). `normalizeScreen` projects both sides of a
// round trip onto the same canonical shape so `toEqual` only fails on REAL
// loss.
//
// The normalization contract:
//  - `rootWidgetIds` and every widget's `children` array are stably sorted by
//    `zIndex` ascending (this is the order the IR actually preserves).
//  - `zIndex` is renumbered from 0, depth-first POST-order over that sorted
//    order (children before their parent) — exactly the numbering
//    `importScreenJSON.ts`'s `zCounter` produces, so a freshly-imported
//    screen is already in normal form for this axis.
//  - `tabOrder` is reset to `[...rootWidgetIds]` (post zIndex-sort) — the
//    IR has no tab-order concept, so import always derives it this way.
//  - Every rule's `id` defaults to `` `r-${widgetId}-${index+1}` `` when unset
//    (export mints this deterministically; a model built without ids should
//    compare equal to one that already has them).
//  - Every rule without a trailing `{ condition: 'true', ... }` catch-all
//    gains one with `value: null` — export folds the catch-all into the IR's
//    `default` field, so a rule with no catch-all (`default` implicitly
//    `null`) and a rule with an explicit `{ condition: 'true', value: null }`
//    catch-all are the same rule from the IR's point of view.
//  - Props entries whose value is `undefined` are dropped (an absent key and
//    a key explicitly set to `undefined` are indistinguishable once
//    serialized to JSON).
//  - `meta.screenId` defaults to `screenIdFromTitle(title)`, `meta.screenKind`
//    defaults to `'screen'` — export's own fallbacks for an unset model.

function stableSortByZIndex(ids: string[], widgets: Record<string, Widget>): string[] {
  return ids
    .map((id, originalIndex) => ({ id, originalIndex }))
    .sort(
      (a, b) => widgets[a.id].zIndex - widgets[b.id].zIndex || a.originalIndex - b.originalIndex
    )
    .map((entry) => entry.id);
}

function dropUndefinedProps(props: Widget['props']): Widget['props'] {
  const cleaned: Widget['props'] = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

function normalizeRule(rule: Rule, widgetId: string, index: number): Rule {
  const expressions = [...rule.expressions];
  const last = expressions.at(-1);
  if (last === undefined || last.condition !== 'true') {
    expressions.push({ condition: 'true', value: null });
  }
  return {
    ...rule,
    id: rule.id ?? `r-${widgetId}-${index + 1}`,
    expressions,
  };
}

export function normalizeScreen(model: ScreenModel): ScreenModel {
  const sortedRootIds = stableSortByZIndex(model.rootWidgetIds, model.widgets);

  const normalizedWidgets: Record<string, Widget> = {};
  let zCounter = 0;

  // Depth-first post-order: recurse into (already z-sorted) children first,
  // then assign this node's own zIndex — mirrors importScreenJSON's `walk`.
  const visit = (id: string): void => {
    const widget = model.widgets[id];
    const sortedChildIds = widget.children
      ? stableSortByZIndex(widget.children, model.widgets)
      : undefined;
    sortedChildIds?.forEach(visit);

    const normalized: Widget = {
      ...widget,
      props: dropUndefinedProps(widget.props),
      rules: widget.rules.map((rule, index) => normalizeRule(rule, id, index)),
      zIndex: zCounter++,
    };
    if (sortedChildIds) normalized.children = sortedChildIds;
    normalizedWidgets[id] = normalized;
  };
  sortedRootIds.forEach(visit);

  const meta: ScreenMeta = {
    ...model.meta,
    screenId: model.meta.screenId ?? screenIdFromTitle(model.meta.title),
    screenKind: model.meta.screenKind ?? 'screen',
  };

  return {
    meta,
    widgets: normalizedWidgets,
    rootWidgetIds: sortedRootIds,
    tabOrder: [...sortedRootIds],
  };
}

// ── mkWidget / mkScreen test helpers ─────────────────────────────────────────

function mkWidget(overrides: Partial<Widget> & Pick<Widget, 'id' | 'type'>): Widget {
  return {
    name: `${overrides.type}_${overrides.id}`,
    layout: { x: 0, y: 0, width: 100, height: 50 },
    visible: true,
    rotation: 0,
    rules: [],
    actions: [],
    props: {},
    zIndex: 0,
    ...overrides,
  };
}

function mkScreen(widgets: Widget[], metaOverrides: Partial<ScreenMeta> = {}): ScreenModel {
  const meta = { ...createDefaultScreenMeta(), ...metaOverrides };
  const byId: Record<string, Widget> = {};
  for (const w of widgets) byId[w.id] = w;
  const rootWidgetIds = widgets.filter((w) => !w.parentId).map((w) => w.id);
  return {
    meta,
    widgets: byId,
    rootWidgetIds,
    tabOrder: [...rootWidgetIds],
  };
}

// ── 1. normalizeScreen sanity ────────────────────────────────────────────────

describe('normalizeScreen', () => {
  it('is idempotent on an already-normalized screen', () => {
    const screen = mkScreen([mkWidget({ id: 'a', type: 'Rectangle', zIndex: 5 })]);
    const once = normalizeScreen(screen);
    const twice = normalizeScreen(once);
    expect(twice).toEqual(once);
  });

  it('sorts siblings by zIndex and renumbers depth-first post-order', () => {
    const screen = mkScreen([
      mkWidget({ id: 'group', type: 'Group', zIndex: 0, children: ['a', 'b'] }),
      mkWidget({ id: 'a', type: 'Rectangle', zIndex: 30, parentId: 'group' }),
      mkWidget({ id: 'b', type: 'Rectangle', zIndex: 10, parentId: 'group' }),
    ]);
    const normalized = normalizeScreen(screen);
    // children reordered b, a (by zIndex 10 < 30)
    expect(normalized.widgets.group.children).toEqual(['b', 'a']);
    // post-order: b=0, a=1, group=2
    expect(normalized.widgets.b.zIndex).toBe(0);
    expect(normalized.widgets.a.zIndex).toBe(1);
    expect(normalized.widgets.group.zIndex).toBe(2);
  });
});

// ── 2. Registry-driven per-type round trip ──────────────────────────────────

// Hard-coded, alphabetically sorted — a future registration must extend this.
const EXPECTED_REGISTERED_TYPES: WidgetType[] = [
  'Arc',
  'Ellipse',
  'EmbeddedScreen',
  'Group',
  'Line',
  'PVButton',
  'PVByteIndicator',
  'PVCheckbox',
  'PVDropdown',
  'PVLed',
  'PVMeter',
  'PVProgressBar',
  'PVRadioGroup',
  'PVShellCommand',
  'PVSlider',
  'PVTextDisplay',
  'PVTextInput',
  'PVToggle',
  'PVWaveformPlot',
  'Polygon',
  'Rectangle',
  'ScreenImage',
  'StaticLabel',
];

function exerciseValue(schema: PropSchema): unknown {
  switch (schema.type) {
    case 'string':
      return `x-${schema.key}`;
    case 'number':
      return schema.min ?? 7;
    case 'boolean':
      return true;
    case 'color':
      return '#123456';
    case 'select':
      return schema.options?.[1]?.value ?? schema.options?.[0]?.value;
    case 'pv':
      return `TEST:${schema.key.toUpperCase()}`;
    default: {
      const _exhaustive: never = schema.type;
      throw new Error(`unhandled propsSchema type: ${String(_exhaustive)}`);
    }
  }
}

function buildExerciseProps(def: WidgetDefinition): Widget['props'] {
  const props: Widget['props'] = { ...def.defaultProps };
  for (const schema of def.propsSchema) {
    props[schema.key] = exerciseValue(schema);
  }
  return props;
}

describe('registry-driven per-type round trip', () => {
  it('registers exactly the expected 23 widget types', () => {
    const registered = widgetRegistry
      .getAll()
      .map((d) => d.type)
      .sort();
    expect(registered).toEqual(EXPECTED_REGISTERED_TYPES);
  });

  it.each(widgetRegistry.getAll())('round-trips $type losslessly', (def: WidgetDefinition) => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: def.type,
        name: `custom name ${def.type}`,
        layout: {
          x: 10,
          y: 20,
          width: def.defaultLayout.width,
          height: def.defaultLayout.height,
        },
        zIndex: 0,
        visible: true,
        rotation: 0,
        rules: [],
        actions: [],
        props: buildExerciseProps(def),
      }),
    ]);

    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const { screen: back, report } = importScreenJSON(doc);

    expect(normalizeScreen(back)).toEqual(normalizeScreen(model));
    expect(report.unknownWidgets).toEqual([]);
    expect(report.degradedWidgets).toEqual([]);
    expect(report.droppedProps).toEqual([]);
    expect(report.droppedRules).toEqual([]);
  });
});

// ── 3. Kitchen-sink screen ───────────────────────────────────────────────────

function kitchenSinkScreen(): ScreenModel {
  const label = mkWidget({
    id: 'label-1',
    type: 'StaticLabel',
    name: 'nested label',
    layout: { x: 5, y: 5, width: 80, height: 20 },
    props: { text: 'Nested' },
    parentId: 'inner-group',
    zIndex: 0,
  });
  const innerGroup = mkWidget({
    id: 'inner-group',
    type: 'Group',
    layout: { x: 10, y: 10, width: 150, height: 100 },
    props: { layoutMode: 'absolute' },
    children: ['label-1'],
    parentId: 'outer-group',
    zIndex: 20,
  });
  const outerGroup = mkWidget({
    id: 'outer-group',
    type: 'Group',
    layout: { x: 0, y: 0, width: 300, height: 300 },
    props: { layoutMode: 'absolute' },
    children: ['inner-group'],
    zIndex: 30,
  });

  const button = mkWidget({
    id: 'button-1',
    type: 'PVButton',
    layout: { x: 320, y: 10, width: 100, height: 30 },
    props: { pvName: 'DEV:CMD', label: 'Fire' },
    actions: [
      {
        type: 'open_display',
        file: 'sub.screen.json',
        macros: { DEV: '${P}' },
        target: 'tab',
      },
      { type: 'write_pv', pvName: 'DEV:CMD', value: 1 },
      { type: 'execute', command: 'do-thing.sh', description: 'runs the thing' },
      { type: 'open_webpage', url: 'https://example.com' },
      { type: 'open_file', file: 'notes.txt' },
    ],
    zIndex: 10,
  });

  const display = mkWidget({
    id: 'display-1',
    type: 'PVTextDisplay',
    layout: { x: 320, y: 60, width: 150, height: 24 },
    props: { pvName: 'formula://f1' },
    rules: [
      {
        name: 'color-by-alarm',
        targetProperty: 'foregroundColor',
        outputExpression: false,
        pvs: [{ name: 'formula://f1', trigger: true }],
        expressions: [
          { condition: '{0} > 1', value: '#ff0000' },
          { condition: '{0} > 2', value: '#ff8800' },
          { condition: 'true', value: '#fff' },
        ],
      },
    ],
    zIndex: 5,
  });

  const specialWidget = mkWidget({
    id: 'special-1',
    type: 'Rectangle',
    name: 'renamed rect',
    layout: { x: 500, y: 10, width: 40, height: 40 },
    visible: false,
    rotation: 45,
    locked: true,
    zIndex: 15,
  });

  const embedded = mkWidget({
    id: 'embedded-1',
    type: 'EmbeddedScreen',
    layout: { x: 500, y: 100, width: 200, height: 150 },
    props: {
      file: 'motor.screen.json',
      macros: { MOTOR: '${P}:M1' },
      resizeMode: 'stretch',
    },
    zIndex: 25,
  });

  const placeholder = mkWidget({
    id: 'placeholder-1',
    type: 'Rectangle',
    layout: { x: 500, y: 300, width: 60, height: 60 },
    props: {
      label: 'legacyWidgetClass',
      fill: false,
      originalClass: 'legacyWidgetClass',
      originalProps: { customProp: 42 },
      warnings: ['No registry entry for legacyWidgetClass; rendering placeholder'],
    },
    zIndex: 35,
  });

  return mkScreen(
    [outerGroup, innerGroup, label, button, display, specialWidget, embedded, placeholder],
    {
      title: 'Kitchen Sink #1!',
      backgroundColor: '#101010',
      theme: 'g10',
      gridSize: 25,
      showGrid: false,
      snapToGrid: false,
      showHorizontalScrollbar: false,
      showVerticalScrollbar: false,
      macros: { P: 'DEV:1', EMPTY: '' },
      formulas: [{ name: 'f1', kind: 'scalar', expression: 'A*2', bindings: { A: '${P}:VAL' } }],
    }
  );
}

describe('kitchen-sink screen', () => {
  it('round-trips losslessly and validates against the IR schema', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });

    expect(validate(doc as unknown)).toEqual([]);

    const { screen: back } = importScreenJSON(doc);
    expect(normalizeScreen(back)).toEqual(normalizeScreen(model));
  });

  it('preserves sibling z-order under shuffled zIndex values', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const rootIds = (doc.root.children ?? []).map((c) => c.id);
    // Ascending zIndex: display-1(5), button-1(10), special-1(15),
    // embedded-1(25), outer-group(30), placeholder-1(35).
    expect(rootIds).toEqual([
      'display-1',
      'button-1',
      'special-1',
      'embedded-1',
      'outer-group',
      'placeholder-1',
    ]);
  });

  it('emits all five action variants on the button', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const buttonNode = (doc.root.children ?? []).find((c) => c.id === 'button-1')!;
    expect(buttonNode.props.actions).toEqual([
      { type: 'open_display', file: 'sub.screen.json', macros: { DEV: '${P}' }, target: 'tab' },
      { type: 'write_pv', pvName: 'DEV:CMD', value: 1 },
      { type: 'execute', command: 'do-thing.sh', description: 'runs the thing' },
      { type: 'open_webpage', url: 'https://example.com' },
      { type: 'open_file', file: 'notes.txt' },
    ]);
  });

  it('folds the trailing catch-all into the IR default', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const displayNode = (doc.root.children ?? []).find((c) => c.id === 'display-1')!;
    const rule = displayNode.rules![0];
    expect(rule.default).toBe('#fff');
    expect('conditions' in rule && rule.conditions).toEqual([
      { expression: '{0} > 1', value: '#ff0000' },
      { expression: '{0} > 2', value: '#ff8800' },
    ]);
    expect('pvs' in rule && rule.pvs).toEqual([{ name: 'formula://f1', trigger: true }]);
  });

  it('carries visible/rotation/locked/name for the special widget', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const specialNode = (doc.root.children ?? []).find((c) => c.id === 'special-1')!;
    expect(specialNode.props.visible).toBe(false);
    expect(specialNode.props.rotation).toBe(45);
    expect(specialNode.props.locked).toBe(true);
    expect(specialNode.props.name).toBe('renamed rect');
  });

  it('keeps the embedded-display file/macros/resizeMode', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const embeddedNode = (doc.root.children ?? []).find((c) => c.id === 'embedded-1')!;
    expect(embeddedNode.type).toBe('embedded-display');
    expect(embeddedNode.props.file).toBe('motor.screen.json');
    expect(embeddedNode.props.macros).toEqual({ MOTOR: '${P}:M1' });
    expect(embeddedNode.props.resizeMode).toBe('stretch');
  });

  it('normalizes the placeholder rectangle to a plain rectangle with its carried props', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const placeholderNode = (doc.root.children ?? []).find((c) => c.id === 'placeholder-1')!;
    expect(placeholderNode.type).toBe('rectangle');
    expect(placeholderNode.props.originalClass).toBe('legacyWidgetClass');
    expect(placeholderNode.props.originalProps).toEqual({ customProp: 42 });
    expect(placeholderNode.props.warnings).toEqual([
      'No registry entry for legacyWidgetClass; rendering placeholder',
    ]);
  });

  it('emits the template-forbidden EMPTY macro default as an empty string on a screen', () => {
    const model = kitchenSinkScreen();
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.macros.find((m) => m.name === 'EMPTY')).toEqual({ name: 'EMPTY', default: '' });
  });
});

// ── 4. Rule without trailing catch-all ──────────────────────────────────────

describe('rule without a trailing catch-all', () => {
  it('appends an explicit null-default catch-all on reimport', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'PVLed',
        props: { pvName: 'DEV:STATE' },
        rules: [
          {
            name: 'no-catch-all',
            targetProperty: 'onColor',
            outputExpression: false,
            pvs: [{ name: 'DEV:STATE', trigger: true }],
            expressions: [{ condition: '{0} > 0', value: '#00ff00' }],
          },
        ],
      }),
    ]);

    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = (doc.root.children ?? [])[0];
    const rule = node.rules![0];
    expect(rule.default).toBeNull();

    const { screen: back } = importScreenJSON(doc);
    const reimportedRule = back.widgets['w1'].rules[0];
    expect(reimportedRule.expressions).toEqual([
      { condition: '{0} > 0', value: '#00ff00' },
      { condition: 'true', value: null },
    ]);
  });
});

// ── 5. Fixture stability ─────────────────────────────────────────────────────

describe('fixture stability', () => {
  const fixtures: { name: string; json: unknown }[] = [
    { name: 'simple', json: simpleFixture },
    { name: 'p1_widgets', json: p1WidgetsFixture },
    { name: 'formula-driven', json: formulaDrivenFixture },
    { name: 'vacuum-system', json: vacuumSystemFixture },
  ];

  it.each(fixtures)('$name is byte-stable after one normalization pass', ({ json }) => {
    const r1 = importScreenJSON(json);
    const e1 = serializeScreenJSON(r1.screen, { savedAt: FIXED });
    const r2 = importScreenJSON(JSON.parse(e1));
    const e2 = serializeScreenJSON(r2.screen, { savedAt: FIXED });

    expect(e2).toBe(e1);
    expect(normalizeScreen(r2.screen)).toEqual(normalizeScreen(r1.screen));
    // The saved document still holds every node under the type it was opened
    // with, so reopening it reports the same placeholders and degrades.
    expect(r2.report.unknownWidgets).toEqual(r1.report.unknownWidgets);
    expect(r2.report.degradedWidgets).toEqual(r1.report.degradedWidgets);
    expect(r2.report.keptRules).toEqual(r1.report.keptRules);
    expect(r2.report.droppedProps).toEqual([]);
    expect(r2.report.droppedRules).toEqual([]);
  });

  it.each(fixtures)('$name saves as the document that was opened', ({ json }) => {
    const opened = json as { metadata: { source: unknown } };
    const saved = exportScreenJSON(importScreenJSON(json).screen, { savedAt: FIXED });
    // `metadata.source` is the one field a save rewrites (see the provenance tests).
    expect({ ...saved, metadata: { ...saved.metadata, source: null } }).toEqual({
      ...opened,
      metadata: { ...opened.metadata, source: null },
    });
  });

  it('simple: canonicalizes widget/rule shapes as expected', () => {
    const r1 = importScreenJSON(simpleFixture);
    const e1 = serializeScreenJSON(r1.screen, { savedAt: FIXED });
    const doc1 = JSON.parse(e1);

    const pvLabel = doc1.root.children.find((c: { id: string }) => c.id === 'w-002');
    expect(pvLabel.type).toBe('pv-label');
    expect(pvLabel.props.pv).toBe('${P}:READBACK');
    const rule = pvLabel.rules[0];
    expect(rule.id).toBe('r-001');
    expect(rule.default).toBe('#ffffff');
    expect(rule.conditions).toEqual([
      { expression: '{0} > 1', value: '#ff0000' },
      { expression: '{1} > 100', value: '#ffff00' },
    ]);

    expect(doc1.formulas).toEqual(simpleFixture.formulas);
    expect(doc1.macros.find((m: { name: string }) => m.name === 'P')).toEqual({
      name: 'P',
      default: 'DEV:1',
    });

    const unknownNode = doc1.root.children.find((c: { id: string }) => c.id === 'w-008');
    expect(unknownNode.type).toBe('unknown-widget');
    expect(unknownNode.props.originalClass).toBe('activeRectangleClass');
    // The placeholder's invented label/fill stay out of the document.
    expect(unknownNode.props).not.toHaveProperty('label');
    expect(unknownNode.props).not.toHaveProperty('fill');
    // Node-level warnings stay node-level through the round trip — they are
    // NOT flattened into the props bag.
    expect(unknownNode.props).not.toHaveProperty('warnings');
    expect(unknownNode.warnings).toEqual([
      'No registry entry for activeRectangleClass; rendering placeholder',
    ]);

    const groupBoxNode = doc1.root.children.find((c: { id: string }) => c.id === 'w-005');
    expect(groupBoxNode.type).toBe('group-box');
    expect(groupBoxNode.props.title).toBe('Controls');
    expect(groupBoxNode.props).not.toHaveProperty('label');
    expect(groupBoxNode.props).not.toHaveProperty('layoutMode');
  });

  it('p1_widgets: related-display-button saves under its own type, file/macros back as props', () => {
    const r1 = importScreenJSON(p1WidgetsFixture);
    expect(r1.screen.widgets['w-003'].actions).toEqual([
      { type: 'open_display', file: 'subscreen', target: 'window', macros: { DEV: '${P}' } },
    ]);
    const e1 = serializeScreenJSON(r1.screen, { savedAt: FIXED });
    const doc1 = JSON.parse(e1);

    const buttonNode = doc1.root.children.find((c: { id: string }) => c.id === 'w-003');
    expect(buttonNode.type).toBe('related-display-button');
    expect(buttonNode.props.label).toBe('Open');
    expect(buttonNode.props.file).toBe('subscreen');
    expect(buttonNode.props.macros).toEqual({ DEV: '${P}' });
    expect(buttonNode.props).not.toHaveProperty('actions');
  });

  it('p1_widgets: an edited related-display-button falls back to regular-button + actions carrier', () => {
    const { screen } = importScreenJSON(p1WidgetsFixture);
    const button = screen.widgets['w-003'];
    // Two actions are more than a related-display-button can say.
    button.actions = [...button.actions, { type: 'open_webpage', url: 'https://example.org' }];
    const doc = exportScreenJSON(screen, { savedAt: FIXED });
    const node = doc.root.children!.find((c) => c.id === 'w-003')!;
    expect(node.type).toBe('regular-button');
    expect(node.props.actions).toEqual([
      { type: 'open_display', file: 'subscreen', target: 'window', macros: { DEV: '${P}' } },
      { type: 'open_webpage', url: 'https://example.org' },
    ]);
    expect(node.props).not.toHaveProperty('file');
  });

  it('p1_widgets: a retargeted related display follows the edit', () => {
    const { screen } = importScreenJSON(p1WidgetsFixture);
    screen.widgets['w-003'].actions = [{ type: 'open_display', file: 'other', target: 'window' }];
    const doc = exportScreenJSON(screen, { savedAt: FIXED });
    const node = doc.root.children!.find((c) => c.id === 'w-003')!;
    expect(node.type).toBe('related-display-button');
    expect(node.props.file).toBe('other');
    expect(node.props).not.toHaveProperty('macros');
  });

  // The fixture declares one formula-driven rule (`w-002`'s `r-001`) with no
  // SB representation — dropped and reported — and one conditional rule
  // (`w-003`'s `r-002`) that survives intact.
  it('formula-driven: both formulas preserved; the formula-driven rule is kept verbatim and reported', () => {
    const r1 = importScreenJSON(formulaDrivenFixture);
    expect(r1.report.droppedRules).toEqual([]);
    expect(r1.report.keptRules.length).toBe(1);
    expect(r1.report.keptRules[0]).toContain('Width tracks formula');

    const e1 = serializeScreenJSON(r1.screen, { savedAt: FIXED });
    const doc1 = JSON.parse(e1);
    expect(doc1.formulas).toEqual(formulaDrivenFixture.formulas);

    // w-002's formula-driven rule has no SB representation: it is not on the
    // editable rule list, but the save writes it back as it came.
    expect(r1.screen.widgets['w-002'].rules).toEqual([]);
    const w002 = doc1.root.children.find((c: { id: string }) => c.id === 'w-002');
    const original = formulaDrivenFixture.root.children.find((c) => c.id === 'w-002')!;
    expect(w002.rules).toEqual(original.rules);

    // w-003's conditional rule survives with its original id.
    const w003 = doc1.root.children.find((c: { id: string }) => c.id === 'w-003');
    expect(w003.rules[0].id).toBe('r-002');
  });

  it('vacuum-system: macro description, widget meta.comment, embedded-display, and an uncoercible precision all preserved', () => {
    const r1 = importScreenJSON(vacuumSystemFixture);
    const e1 = serializeScreenJSON(r1.screen, { savedAt: FIXED });
    const doc1 = JSON.parse(e1);

    expect(doc1.macros.find((m: { name: string }) => m.name === 'PREFIX')).toEqual({
      name: 'PREFIX',
      default: 'DEMO:VAC1',
      description: 'Device prefix',
    });

    const w002 = doc1.root.children.find((c: { id: string }) => c.id === 'w-002');
    expect(w002.meta.comment).toBe('Primary pressure readout — DO NOT MOVE');
    expect(w002.rules[0].id).toBe('r-001');
    // `precision: "fromPV"` is not a number, so the model has no prop for it;
    // it rides in the passthrough and is written back.
    expect(r1.screen.widgets['w-002'].props.precision).toBeUndefined();
    expect(w002.props.precision).toBe('fromPV');

    const embeddedNode = doc1.root.children.find(
      (c: { type: string }) => c.type === 'embedded-display'
    );
    expect(embeddedNode.props.file).toBe('motor-control.screen.json');
    expect(embeddedNode.props.macros).toEqual({ MOTOR: '${PREFIX}:M1' });
  });
});

// ── 6. Determinism ───────────────────────────────────────────────────────────

describe('determinism', () => {
  it('two exports of the same model with the same savedAt serialize identically', () => {
    const model = kitchenSinkScreen();
    const e1 = serializeScreenJSON(model, { savedAt: FIXED });
    const e2 = serializeScreenJSON(model, { savedAt: FIXED });
    expect(e2).toBe(e1);
  });
});

// ── 7. Converter-vocabulary pv-button binding ────────────────────────────────
//
// The IR's `pv` key must land on `pvName` — the key the button component and
// its inspector schema actually read — and re-emit as `pv-button` + `pv`. A
// mapping that round-trips on paper but binds nothing in the builder is the
// failure mode this pins down.

describe('converter-emitted pv-button', () => {
  const buttonDoc = {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'button-screen',
    metadata: {
      title: 'Buttons',
      source: { type: 'edl-converter' },
      size: { width: 200, height: 100 },
    },
    macros: [],
    root: {
      id: 'root',
      type: 'absolute-canvas',
      props: {},
      geometry: { x: 0, y: 0, width: 200, height: 100 },
      children: [
        {
          id: 'w-001',
          type: 'pv-button',
          props: { pv: 'DEV:CMD', label: 'Fire' },
          geometry: { x: 0, y: 0, width: 100, height: 30 },
        },
      ],
    },
  };

  it('imports the binding onto pvName, the key the component and inspector read', () => {
    const { screen } = importScreenJSON(buttonDoc);
    expect(screen.widgets['w-001'].props.pvName).toBe('DEV:CMD');
    const inspectorKeys = widgetRegistry.get('PVButton')!.propsSchema.map((s) => s.key);
    expect(inspectorKeys).toContain('pvName');
  });

  it('round-trips back to pv-button under the IR pv key', () => {
    const { screen } = importScreenJSON(buttonDoc);
    const out = exportScreenJSON(screen, { savedAt: FIXED });
    const node = out.root.children![0];
    expect(node.type).toBe('pv-button');
    expect(node.props.pv).toBe('DEV:CMD');
    expect(node.props).not.toHaveProperty('pvName');
  });

  it('a button with no control binding exports as regular-button', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'PVButton', props: { label: 'Noop' } })]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.root.children![0].type).toBe('regular-button');
  });
});

// ── 8. Node-level warnings passthrough ───────────────────────────────────────

describe('node-level warnings', () => {
  it('survive import → save on a known widget type, node-level (not as a prop)', () => {
    const doc = {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'warned',
      metadata: {
        title: 'Warned',
        source: { type: 'edl-converter' },
        size: { width: 100, height: 100 },
      },
      macros: [],
      root: {
        id: 'root',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: 'w-001',
            type: 'arc',
            props: {},
            geometry: { x: 0, y: 0, width: 40, height: 40 },
            warnings: ['arc fill approximated'],
          },
        ],
      },
    };

    const { screen, report } = importScreenJSON(doc);
    expect(screen.widgets['w-001'].warnings).toEqual(['arc fill approximated']);
    // Still echoed into the one-time import report as before.
    expect(report.warnings).toContain('arc fill approximated');

    const out = exportScreenJSON(screen, { savedAt: FIXED });
    const node = out.root.children![0];
    expect(node.warnings).toEqual(['arc fill approximated']);
    expect(node.props).not.toHaveProperty('warnings');
  });
});

// ── 9. Converter output: open → save gives back the document ─────────────────
//
// Shapes the EDM converter actually emits that the model has no direct home
// for. Each one is carried on `Widget.ir` / `ScreenMeta` so an unedited save
// is the opened document again.

function converterDoc(children: unknown[], rootExtras: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    kind: 'screen',
    id: 'ads/bld_diagnostics',
    metadata: {
      title: 'bld_diagnostics',
      source: { type: 'edl-converter', sourceFile: 'ads/bld_diagnostics.edl' },
      size: { width: 400, height: 300 },
    },
    macros: [{ name: 'P', default: '' }],
    root: {
      id: 'w-001',
      type: 'absolute-canvas',
      props: { backgroundColor: '#c8c8c8', height: 300, width: 400 },
      geometry: { x: 0, y: 0, width: 400, height: 300 },
      children,
      ...rootExtras,
    },
  };
}

const at = (n: number) => ({ x: 10, y: 10 * n, width: 100, height: 20 });

/** What is left to compare once the one field a save rewrites is set aside. */
function withoutSource(doc: unknown) {
  const d = doc as { metadata: Record<string, unknown> };
  return { ...d, metadata: { ...d.metadata, source: null } };
}

describe('converter output round trip', () => {
  const children = [
    // precision the model cannot hold as a number
    {
      id: 'w-002',
      type: 'pv-label',
      props: { pv: '${P}:RBV', precision: 'fromPV' },
      geometry: at(1),
    },
    // macro where the model wants a number
    {
      id: 'w-003',
      type: 'pv-progress-bar',
      props: { pv: '${P}:TMIT', min: '${scaleMin}', max: '${scaleMax}' },
      geometry: at(2),
    },
    // related display with and without a target
    {
      id: 'w-004',
      type: 'related-display-button',
      props: { label: 'Config', file: 'config.screen.json', macros: { DEV: '${P}' }, fontSize: 10 },
      geometry: at(3),
    },
    { id: 'w-005', type: 'related-display-button', props: { label: 'Nothing' }, geometry: at(4) },
    // a button that only reads a state PV: pv-button with no control pv
    {
      id: 'w-006',
      type: 'pv-button',
      props: { readbackPV: '${P}:STATE', onLabel: 'On', offLabel: 'Off' },
      geometry: at(5),
    },
    // an action vocabulary the builder does not know stays a plain prop
    {
      id: 'w-007',
      type: 'regular-button',
      props: {
        label: 'Camera',
        actions: [{ type: 'shell_command', command: 'firefox http://cam' }],
      },
      geometry: at(6),
      warnings: [
        'EDM shell commands carried as actions; the web runtime does not execute shell commands',
      ],
    },
    {
      id: 'w-008',
      type: 'unknown-widget',
      props: { originalClass: 'menuMuxClass', originalProps: { controlPv: '${P}:MUX' } },
      geometry: at(7),
      warnings: ['No registry entry for menuMuxClass; rendering placeholder'],
    },
    // a type newer than the builder
    { id: 'w-009', type: 'pv-sparkline', props: { pv: '${P}:HIST', points: 50 }, geometry: at(8) },
    // converter containers
    {
      id: 'w-010',
      type: 'group-box',
      props: { title: 'Magnets' },
      geometry: at(9),
      children: [{ id: 'w-011', type: 'frame', props: {}, geometry: at(10) }],
    },
  ];
  const doc = converterDoc(children, {
    warnings: [
      '2 widget(s) lie entirely outside the 400x300 canvas; kept in the IR, clipped at runtime',
    ],
  });

  it('saves the opened document back, node for node', () => {
    const saved = exportScreenJSON(importScreenJSON(doc).screen, { savedAt: FIXED });
    expect(validate(saved)).toEqual([]);
    expect(withoutSource(saved)).toEqual(withoutSource(doc));
  });

  it('keeps the provenance of the opened document under the builder stamp', () => {
    const saved = exportScreenJSON(importScreenJSON(doc).screen, { savedAt: FIXED });
    expect(saved.metadata.source).toEqual({
      type: 'screen-builder',
      savedAt: FIXED,
      sourceFile: 'ads/bld_diagnostics.edl',
      origin: 'edl-converter',
    });
    // A second open → save keeps the first origin rather than recording the builder.
    const again = exportScreenJSON(importScreenJSON(saved).screen, { savedAt: FIXED });
    expect(again).toEqual(saved);
  });

  it('writes a model value over a carried one once the prop is set in the editor', () => {
    const { screen } = importScreenJSON(doc);
    screen.widgets['w-002'].props.precision = 3;
    screen.widgets['w-003'].props.minValue = 0;
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    const node = (id: string) => saved.root.children!.find((c) => c.id === id)!;
    expect(node('w-002').props.precision).toBe(3);
    expect(node('w-003').props.min).toBe(0);
    expect(node('w-003').props.max).toBe('${scaleMax}');
  });

  it('gives a pv-button its control PV back under `pv` when one is added', () => {
    const { screen } = importScreenJSON(doc);
    screen.widgets['w-006'].props.pvName = '${P}:CTRL';
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    const node = saved.root.children!.find((c) => c.id === 'w-006')!;
    expect(node.type).toBe('pv-button');
    expect(node.props.pv).toBe('${P}:CTRL');
  });

  it('a related display that gains a control PV is no longer one', () => {
    const { screen } = importScreenJSON(doc);
    screen.widgets['w-004'].props.pvName = '${P}:CTRL';
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    const node = saved.root.children!.find((c) => c.id === 'w-004')!;
    expect(node.type).toBe('pv-button');
    expect(node.props.actions).toEqual([
      {
        type: 'open_display',
        file: 'config.screen.json',
        target: 'window',
        macros: { DEV: '${P}' },
      },
    ]);
  });

  it('keeps edits made to a placeholder without disturbing the node it stands for', () => {
    const { screen } = importScreenJSON(doc);
    screen.widgets['w-008'].props.label = 'mux (todo)';
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    const node = saved.root.children!.find((c) => c.id === 'w-008')!;
    expect(node.type).toBe('unknown-widget');
    expect(node.props).toEqual({
      label: 'mux (todo)',
      originalClass: 'menuMuxClass',
      originalProps: { controlPv: '${P}:MUX' },
    });
  });

  it('writes editor chrome and widget names only once they leave their defaults', () => {
    const { screen } = importScreenJSON(doc);
    const untouched = exportScreenJSON(screen, { savedAt: FIXED });
    expect(Object.keys(untouched.root.props).sort()).toEqual([
      'backgroundColor',
      'height',
      'width',
    ]);

    screen.meta.gridSize = 5;
    screen.meta.showGrid = false;
    screen.widgets['w-002'].name = 'beam readback';
    const edited = exportScreenJSON(screen, { savedAt: FIXED });
    expect(edited.root.props.gridSize).toBe(5);
    expect(edited.root.props.showGrid).toBe(false);
    expect(edited.root.props).not.toHaveProperty('snapToGrid');
    expect(edited.root.children!.find((c) => c.id === 'w-002')!.props.name).toBe('beam readback');

    const back = importScreenJSON(edited).screen;
    expect(back.meta.gridSize).toBe(5);
    expect(back.meta.showGrid).toBe(false);
    expect(back.widgets['w-002'].name).toBe('beam readback');
  });

  it('carries root props it does not model', () => {
    const withExtra = converterDoc([], {
      props: { width: 400, height: 300, gridSize: 'wide', scrollPolicy: 'never' },
    });
    const { screen } = importScreenJSON(withExtra);
    // A malformed chrome value is not imported, and not thrown away either.
    expect(screen.meta.gridSize).toBe(createDefaultScreenMeta().gridSize);
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    expect(saved.root.props).toEqual({
      width: 400,
      height: 300,
      gridSize: 'wide',
      scrollPolicy: 'never',
    });
  });

  it('saves a hand-authored `pv` on an identity type back under `pv`', () => {
    const toggled = converterDoc([
      { id: 'w-002', type: 'pv-toggle', props: { pv: '${P}:ENABLE' }, geometry: at(1) },
    ]);
    const { screen } = importScreenJSON(toggled);
    expect(screen.widgets['w-002'].props.pvName).toBe('${P}:ENABLE');
    const saved = exportScreenJSON(screen, { savedAt: FIXED });
    expect(saved.root.children![0].props).toEqual({ pv: '${P}:ENABLE' });
  });
});
