import { describe, it, expect } from 'vitest';
import {
  ExportError,
  exportScreenJSON,
  screenIdFromTitle,
  serializeScreenJSON,
} from './exportScreenJSON';
import type { ScreenMeta, ScreenModel, Widget } from '../../types/widget';
import { createDefaultScreenMeta } from '../../types/widget';

const FIXED = '2026-07-06T00:00:00.000Z';

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

describe('exportScreenJSON — negative / validation coverage', () => {
  it('throws ExportError on an invalid macro name', () => {
    // A leading digit breaks the macro-name pattern.
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })], {
      macros: { '1bad': 'x' },
    });
    expect(() => exportScreenJSON(model, { savedAt: FIXED })).toThrow(ExportError);
  });

  it('throws on a rule with outputExpression: true', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        rules: [
          {
            name: 'bad-rule',
            targetProperty: 'x',
            outputExpression: true,
            pvs: [],
            expressions: [],
          },
        ],
      }),
    ]);
    expect(() => exportScreenJSON(model, { savedAt: FIXED })).toThrow(ExportError);
  });

  it('throws on a non-scalar rule expression value', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        rules: [
          {
            name: 'object-value',
            targetProperty: 'x',
            outputExpression: false,
            pvs: [{ name: 'DEV:PV', trigger: true }],
            expressions: [
              { condition: '{0} > 1', value: { nested: true } },
              { condition: 'true', value: 0 },
            ],
          },
        ],
      }),
    ]);
    expect(() => exportScreenJSON(model, { savedAt: FIXED })).toThrow(ExportError);
  });

  it('throws on NaN geometry', () => {
    const model = mkScreen([
      mkWidget({ id: 'w1', type: 'Rectangle', layout: { x: NaN, y: 0, width: 10, height: 10 } }),
    ]);
    expect(() => exportScreenJSON(model, { savedAt: FIXED })).toThrow(ExportError);
  });

  it('throws when a rule pv references a formula:// formula with no formulas entry', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'PVLed',
        props: { pvName: 'DEV:STATE' },
        rules: [
          {
            name: 'missing-formula',
            targetProperty: 'onColor',
            outputExpression: false,
            pvs: [{ name: 'formula://missing', trigger: true }],
            expressions: [{ condition: 'true', value: '#00ff00' }],
          },
        ],
      }),
    ]);
    // No `formulas` on meta at all — 'formula://missing' resolves against nothing.
    expect(() => exportScreenJSON(model, { savedAt: FIXED })).toThrow(ExportError);
  });

  it('template kind omits the macro default key entirely', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })], {
      screenKind: 'template',
      macros: { P: '' },
    });
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.kind).toBe('template');
    const macro = doc.macros.find((m) => m.name === 'P')!;
    expect(macro).not.toHaveProperty('default');
    expect(Object.keys(macro)).toEqual(['name']);
  });
});

describe('exportScreenJSON — metadata / id assembly', () => {
  it('sets metadata.source to { type: screen-builder, savedAt: <injected> }', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.metadata.source).toEqual({ type: 'screen-builder', savedAt: FIXED });
  });

  it('screenIdFromTitle slugifies as specified', () => {
    expect(screenIdFromTitle('My Screen! 2')).toBe('my-screen-2');
  });

  it('falls back to screenIdFromTitle(title) when meta.screenId is unset', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })], { title: 'My Screen! 2' });
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.id).toBe('my-screen-2');
  });

  it('meta.screenId wins over the title-derived fallback when set', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })], {
      title: 'My Screen! 2',
      screenId: 'explicit-id',
    });
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.id).toBe('explicit-id');
  });
});

describe('exportScreenJSON — prop key ordering', () => {
  it('emits widget props keys alphabetically sorted', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        props: { zebra: 1, apple: 2, mango: 3 },
      }),
    ]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(Object.keys(node.props)).toEqual(['apple', 'mango', 'zebra']);
  });
});

describe('exportScreenJSON — reserved carrier props', () => {
  it('emits visible:false, rotation, locked:true, and a renamed name when set', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        name: 'my custom name',
        visible: false,
        rotation: 45,
        locked: true,
      }),
    ]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(node.props.name).toBe('my custom name');
    expect(node.props.visible).toBe(false);
    expect(node.props.rotation).toBe(45);
    expect(node.props.locked).toBe(true);
  });

  it('emits the actions carrier only when non-empty', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        actions: [{ type: 'open_file', file: 'x.txt' }],
      }),
    ]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(node.props.actions).toEqual([{ type: 'open_file', file: 'x.txt' }]);
  });

  it('omits visible/rotation/locked/actions carriers for default values', () => {
    const model = mkScreen([
      mkWidget({
        id: 'w1',
        type: 'Rectangle',
        visible: true,
        rotation: 0,
        locked: false,
        actions: [],
      }),
    ]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(node.props).not.toHaveProperty('visible');
    expect(node.props).not.toHaveProperty('rotation');
    expect(node.props).not.toHaveProperty('locked');
    expect(node.props).not.toHaveProperty('actions');
    // A name still at the generated default is what an import falls back
    // to anyway, so it is not written either.
    expect(node.props).not.toHaveProperty('name');
  });

  it('omits the locked carrier when unset (undefined)', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(node.props).not.toHaveProperty('locked');
  });
});

describe('exportScreenJSON — node-level warnings', () => {
  it('emits Widget.warnings at the node level, never as a prop', () => {
    const model = mkScreen([
      mkWidget({ id: 'w1', type: 'Rectangle', warnings: ['converter note'] }),
    ]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    const node = doc.root.children![0];
    expect(node.warnings).toEqual(['converter note']);
    expect(node.props).not.toHaveProperty('warnings');
  });

  it('omits warnings when absent or empty', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle', warnings: [] })]);
    const doc = exportScreenJSON(model, { savedAt: FIXED });
    expect(doc.root.children![0]).not.toHaveProperty('warnings');
  });
});

describe('exportScreenJSON — document id', () => {
  it('freshId re-derives the id from the title, ignoring meta.screenId', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })], {
      title: 'Forked Copy',
      screenId: 'original-id',
    });
    expect(exportScreenJSON(model, { savedAt: FIXED }).id).toBe('original-id');
    expect(exportScreenJSON(model, { savedAt: FIXED, freshId: true }).id).toBe('forked-copy');
  });
});

describe('serializeScreenJSON', () => {
  it('produces 2-space-indented JSON with a trailing newline', () => {
    const model = mkScreen([mkWidget({ id: 'w1', type: 'Rectangle' })]);
    const text = serializeScreenJSON(model, { savedAt: FIXED });
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(JSON.parse(text)).toEqual(exportScreenJSON(model, { savedAt: FIXED }));
    // 2-space indent sanity check on a nested field.
    expect(text).toContain('  "schemaVersion"');
  });
});
