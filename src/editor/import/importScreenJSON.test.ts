import { describe, it, expect } from 'vitest';
import { importScreenJSON, ImportValidationError } from './importScreenJSON';
import { generateTSX } from '../code/generateTSX';
import simple from './__fixtures__/simple.screen.json';
import malformed from './__fixtures__/malformed.screen.json';

describe('importScreenJSON', () => {
  const { screen, report } = importScreenJSON(simple);

  it('flattens the tree, excluding the absolute-canvas root', () => {
    // 7 widgets: w-002..w-008 (w-001 is the canvas root, not a widget).
    expect(Object.keys(screen.widgets)).toHaveLength(7);
  });

  it('reuses IR ids verbatim (no re-minting)', () => {
    expect(Object.keys(screen.widgets).sort()).toEqual([
      'w-002',
      'w-003',
      'w-004',
      'w-005',
      'w-006',
      'w-007',
      'w-008',
    ]);
    expect(screen.rootWidgetIds).toEqual(['w-002', 'w-003', 'w-004', 'w-005', 'w-008']);
  });

  it('maps widget types and renames pv → pvName', () => {
    expect(screen.widgets['w-002'].type).toBe('PVTextDisplay');
    expect(screen.widgets['w-002'].props.pvName).toBe('${P}:READBACK');
    expect(screen.widgets['w-004'].type).toBe('PVSlider');
    expect(screen.widgets['w-004'].props.minValue).toBe(0);
    expect(screen.widgets['w-004'].props.maxValue).toBe(10);
    expect(screen.widgets['w-004'].props.showValueLabel).toBe(true);
  });

  it('preserves unknown-widget as a reported Rectangle placeholder', () => {
    const ph = screen.widgets['w-008'];
    expect(ph.type).toBe('Rectangle');
    expect(ph.props.originalClass).toBe('activeRectangleClass');
    expect(ph.props.originalProps).toEqual({ lineColor: 'index 3', fill: true });
    // Node-level warnings ride on Widget.warnings (durable), not in props.
    expect(ph.warnings).toEqual([
      'No registry entry for activeRectangleClass; rendering placeholder',
    ]);
    expect(ph.props).not.toHaveProperty('warnings');
    expect(report.unknownWidgets).toContainEqual({
      originalClass: 'activeRectangleClass',
      count: 1,
    });
  });

  it('maps geometry 1:1 with no relativization, including container children', () => {
    expect(screen.widgets['w-002'].layout).toEqual({ x: 20, y: 20, width: 120, height: 18 });
    // w-006 is a child of group-box w-005; its geometry stays absolute.
    expect(screen.widgets['w-006'].layout).toEqual({ x: 310, y: 40, width: 60, height: 24 });
    expect(screen.widgets['w-006'].parentId).toBe('w-005');
    expect(screen.widgets['w-005'].children).toEqual(['w-006', 'w-007']);
  });

  it('keeps z-order stable (increasing zIndex in document order)', () => {
    expect(screen.widgets['w-006'].zIndex).toBeLessThan(screen.widgets['w-007'].zIndex);
    expect(screen.widgets['w-002'].zIndex).toBeLessThan(screen.widgets['w-008'].zIndex);
  });

  it('maps a conditional rule and folds default into a trailing catch-all', () => {
    const rule = screen.widgets['w-002'].rules.find((r) => r.name === 'color-by-alarm');
    expect(rule).toBeDefined();
    expect(rule!.expressions[0]).toEqual({ condition: '{0} > 1', value: '#ff0000' });
    expect(rule!.expressions[1]).toEqual({ condition: '{1} > 100', value: '#ffff00' });
    expect(rule!.expressions.at(-1)).toEqual({ condition: 'true', value: '#ffffff' });
    expect(rule!.pvs.map((p) => p.name)).toEqual(['${P}:SEVR', 'formula://sum']);
  });

  it('drops formula-driven rules and reports them', () => {
    const rules = screen.widgets['w-002'].rules;
    expect(rules.find((r) => r.name === 'visible-when')).toBeUndefined();
    expect(report.droppedRules.some((r) => r.includes('visible-when'))).toBe(true);
  });

  it('reports degraded container widgets', () => {
    expect(report.degradedWidgets.some((d) => d.widgetId === 'w-005')).toBe(true);
    // group-box → Group, title carried as label
    expect(screen.widgets['w-005'].type).toBe('Group');
    expect(screen.widgets['w-005'].props.label).toBe('Controls');
  });

  it('imports screen-level formulas losslessly onto meta', () => {
    expect(screen.meta.formulas).toEqual(simple.formulas);
    expect(screen.meta.width).toBe(640);
    expect(screen.meta.macros).toEqual({ P: 'DEV:1' });
  });

  it('throws ImportValidationError on a malformed document', () => {
    expect(() => importScreenJSON(malformed)).toThrow(ImportValidationError);
  });

  it('tolerates a converter document that omits empty macros', () => {
    // The converter omits `macros` entirely when a screen has none; the editor
    // must read it (regression for the live .ui/.edl path).
    const noMacros = {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'nomac',
      metadata: {
        title: 'No Macros',
        source: { type: 'ui-converter' },
        size: { width: 100, height: 100 },
      },
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: 'w-002',
            type: 'text-label',
            props: { text: 'Hi' },
            geometry: { x: 0, y: 0, width: 40, height: 12 },
          },
        ],
      },
    };
    const { screen } = importScreenJSON(noMacros);
    expect(screen.meta.macros).toEqual({});
    expect(screen.widgets['w-002'].type).toBe('StaticLabel');
  });

  it('round-trips through generateTSX without throwing (eject gate)', () => {
    const tsx = generateTSX(screen);
    expect(() => generateTSX(screen)).not.toThrow();
    expect(tsx).toContain('<Rectangle'); // unknown-widget placeholder
    expect(tsx).toContain('<Group'); // container
    expect(tsx).toContain('formulas:'); // formulas survive eject
  });

  it('lifts document id/kind onto meta.screenId/meta.screenKind', () => {
    expect(screen.meta.screenId).toBe('simple');
    expect(screen.meta.screenKind).toBe('screen');
  });
});

describe('importScreenJSON — new passthrough/carrier behaviors', () => {
  it('lifts a non-empty widget meta.comment onto Widget.meta', () => {
    const doc = {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'meta-comment',
      metadata: {
        title: 'Meta Comment',
        source: { type: 'screen-builder', savedAt: '2026-01-01T00:00:00Z' },
        size: { width: 100, height: 100 },
      },
      macros: [],
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: 'w-002',
            type: 'rectangle',
            props: {},
            geometry: { x: 0, y: 0, width: 10, height: 10 },
            meta: { comment: 'DO NOT MOVE' },
          },
          {
            id: 'w-003',
            type: 'rectangle',
            props: {},
            geometry: { x: 0, y: 0, width: 10, height: 10 },
            meta: { comment: '' },
          },
        ],
      },
    };
    const { screen } = importScreenJSON(doc);
    expect(screen.widgets['w-002'].meta).toEqual({ comment: 'DO NOT MOVE' });
    // An empty-string comment is not carried (nothing to preserve).
    expect(screen.widgets['w-003'].meta).toBeUndefined();
  });

  it('lifts document-level id/kind/description/author/macroDescriptions onto meta', () => {
    const doc = {
      schemaVersion: '1.0',
      kind: 'template',
      id: 'my-template',
      metadata: {
        title: 'A Template',
        source: { type: 'screen-builder', savedAt: '2026-01-01T00:00:00Z' },
        size: { width: 100, height: 100 },
        description: 'A description',
        author: 'jdoe',
      },
      macros: [{ name: 'P', description: 'device prefix' }],
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [],
      },
    };
    const { screen } = importScreenJSON(doc);
    expect(screen.meta.screenId).toBe('my-template');
    expect(screen.meta.screenKind).toBe('template');
    expect(screen.meta.description).toBe('A description');
    expect(screen.meta.author).toBe('jdoe');
    expect(screen.meta.macroDescriptions).toEqual({ P: 'device prefix' });
  });

  it('lifts reserved carrier props (name/actions/visible/rotation/locked) off a widget onto the Widget', () => {
    const doc = {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'carriers',
      metadata: {
        title: 'Carriers',
        source: { type: 'screen-builder', savedAt: '2026-01-01T00:00:00Z' },
        size: { width: 100, height: 100 },
      },
      macros: [],
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: 'w-002',
            type: 'rectangle',
            props: {
              name: 'my custom name',
              visible: false,
              rotation: 45,
              locked: true,
              actions: [{ type: 'open_file', file: 'x.txt' }],
            },
            geometry: { x: 0, y: 0, width: 10, height: 10 },
          },
        ],
      },
    };
    const { screen, report } = importScreenJSON(doc);
    const widget = screen.widgets['w-002'];
    expect(widget.name).toBe('my custom name');
    expect(widget.visible).toBe(false);
    expect(widget.rotation).toBe(45);
    expect(widget.locked).toBe(true);
    expect(widget.actions).toEqual([{ type: 'open_file', file: 'x.txt' }]);
    // Carriers are lifted OUT of props, not left behind.
    expect(widget.props).not.toHaveProperty('name');
    expect(widget.props).not.toHaveProperty('visible');
    expect(widget.props).not.toHaveProperty('rotation');
    expect(widget.props).not.toHaveProperty('locked');
    expect(widget.props).not.toHaveProperty('actions');
    expect(report.warnings).toEqual([]);
  });

  it('keeps an unrecognized actions prop as a plain prop and warns', () => {
    const doc = {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'bad-actions',
      metadata: {
        title: 'Bad Actions',
        source: { type: 'screen-builder', savedAt: '2026-01-01T00:00:00Z' },
        size: { width: 100, height: 100 },
      },
      macros: [],
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        children: [
          {
            id: 'w-002',
            type: 'rectangle',
            props: { actions: 'not-a-list' },
            geometry: { x: 0, y: 0, width: 10, height: 10 },
          },
        ],
      },
    };
    const { screen, report } = importScreenJSON(doc);
    expect(screen.widgets['w-002'].props.actions).toBe('not-a-list');
    expect(screen.widgets['w-002'].actions).toEqual([]);
    expect(
      report.warnings.some((w) => w.includes("'actions' prop that is not a recognized action list"))
    ).toBe(true);
  });
});

describe('importScreenJSON — newly supported .ui widgets', () => {
  function docWith(child: Record<string, unknown>) {
    return {
      schemaVersion: '1.0',
      kind: 'screen',
      id: 'newly',
      metadata: {
        title: 'Newly Supported',
        source: { type: 'ui-converter' },
        size: { width: 500, height: 400 },
      },
      root: {
        id: 'w-001',
        type: 'absolute-canvas',
        props: {},
        geometry: { x: 0, y: 0, width: 500, height: 400 },
        children: [child],
      },
    };
  }

  it('imports a shell-command-button as PVShellCommand with command + label', () => {
    const { screen, report } = importScreenJSON(
      docWith({
        id: 'w-002',
        type: 'shell-command-button',
        props: { command: 'probe ${P}', label: 'Probe...', showIcon: false, alarmBorder: true },
        geometry: { x: 10, y: 10, width: 120, height: 24 },
      })
    );
    const w = screen.widgets['w-002'];
    expect(w.type).toBe('PVShellCommand');
    expect(w.props.command).toBe('probe ${P}');
    expect(w.props.label).toBe('Probe...');
    expect(w.props.alarmSensitiveBorder).toBe(true);
    expect(report.unknownWidgets).toEqual([]);
  });

  it('imports a waveform-plot as PVWaveformPlot preserving curves + title', () => {
    const curves = [{ y_channel: '${P}:TEMP', color: '#e00000', lineWidth: 1 }];
    const { screen, report } = importScreenJSON(
      docWith({
        id: 'w-002',
        type: 'waveform-plot',
        props: { title: 'Temps', curves, xLabels: ['Time'] },
        geometry: { x: 0, y: 0, width: 260, height: 200 },
      })
    );
    const w = screen.widgets['w-002'];
    expect(w.type).toBe('PVWaveformPlot');
    expect(w.props.title).toBe('Temps');
    expect(w.props.curves).toEqual(curves);
    expect(w.props.xLabels).toEqual(['Time']);
    expect(report.unknownWidgets).toEqual([]);
  });

  it('imports a qwidget-container as a Group with its children', () => {
    const { screen, report } = importScreenJSON(
      docWith({
        id: 'w-002',
        type: 'qwidget-container',
        props: {},
        geometry: { x: 10, y: 10, width: 200, height: 120 },
        children: [
          {
            id: 'w-003',
            type: 'pv-label',
            props: { pv: '${P}:RBV' },
            geometry: { x: 20, y: 20, width: 100, height: 18 },
          },
        ],
      })
    );
    expect(screen.widgets['w-002'].type).toBe('Group');
    expect(screen.widgets['w-002'].children).toEqual(['w-003']);
    expect(screen.widgets['w-003'].type).toBe('PVTextDisplay');
    expect(screen.widgets['w-003'].parentId).toBe('w-002');
    expect(report.unknownWidgets).toEqual([]);
  });
});
