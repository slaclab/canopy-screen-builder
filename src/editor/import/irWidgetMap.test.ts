import { describe, it, expect } from 'vitest';
import type { WidgetNode } from '@slaclab/canopy-screen-ir';
import { mapWidget } from './irWidgetMap';

function node(type: string, props: WidgetNode['props']): WidgetNode {
  return { id: 'w1', type, props, geometry: { x: 0, y: 0, width: 160, height: 100 } };
}

describe('mapWidget pv-meter', () => {
  it('maps the full IR contract onto SB prop names', () => {
    const r = mapWidget(
      node('pv-meter', {
        pv: 'CAV:TEMP',
        min: -10,
        max: 250,
        label: 'Cavity',
        showValue: false,
        units: 'C',
      })
    );
    expect(r.sbType).toBe('PVMeter');
    expect(r.unknown).toBeUndefined();
    expect(r.props.pvName).toBe('CAV:TEMP');
    expect(r.props.minValue).toBe(-10);
    expect(r.props.maxValue).toBe(250);
    expect(r.props.label).toBe('Cavity');
    expect(r.props.showValueLabel).toBe(false);
    expect(r.props.units).toBe('C');
    // Renamed IR keys must not linger under their old names.
    expect(r.props.pv).toBeUndefined();
    expect(r.props.min).toBeUndefined();
    expect(r.props.max).toBeUndefined();
    expect(r.props.showValue).toBeUndefined();
  });

  it('maps a minimal node (pv only) without inventing defaults', () => {
    const r = mapWidget(node('pv-meter', { pv: 'X:VAL' }));
    expect(r.sbType).toBe('PVMeter');
    expect(r.props.pvName).toBe('X:VAL');
    // Defaults (min 0 / max 100 / showValue true) live in the widget
    // registration, not the import mapping.
    expect('minValue' in r.props).toBe(false);
    expect('maxValue' in r.props).toBe(false);
    expect('showValueLabel' in r.props).toBe(false);
    expect('units' in r.props).toBe(false);
  });
});

describe('mapWidget pv-radio-group', () => {
  it('maps pv, orientation and alarmSensitive onto SB prop names', () => {
    const r = mapWidget(
      node('pv-radio-group', { pv: 'X:STATE', orientation: 'horizontal', alarmSensitive: true })
    );
    expect(r.sbType).toBe('PVRadioGroup');
    expect(r.unknown).toBeUndefined();
    expect(r.props.pvName).toBe('X:STATE');
    expect(r.props.orientation).toBe('horizontal');
    expect(r.props.alarmSensitiveBorder).toBe(true);
    expect(r.props.pv).toBeUndefined();
  });

  it('maps a minimal node (pv only), leaving orientation to the registered default', () => {
    const r = mapWidget(node('pv-radio-group', { pv: 'X:STATE' }));
    expect(r.sbType).toBe('PVRadioGroup');
    expect(r.props.pvName).toBe('X:STATE');
    expect('orientation' in r.props).toBe(false);
    expect('alarmSensitiveBorder' in r.props).toBe(false);
  });
});

describe('mapWidget polygon', () => {
  it('maps a polygon IR node to the Polygon widget (not an unknown placeholder)', () => {
    const r = mapWidget(
      node('polygon', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        closed: true,
        lineColor: '#6f6f6f',
      })
    );
    expect(r.sbType).toBe('Polygon');
    expect(r.unknown).toBeUndefined();
    expect(r.props.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]);
    expect(r.props.closed).toBe(true);
  });
});

describe('mapWidget IR passthrough', () => {
  it('carries a consumed value the mapper cannot coerce, instead of dropping it', () => {
    const r = mapWidget(node('pv-label', { pv: 'X:RBV', precision: 'fromPV' }));
    expect('precision' in r.props).toBe(false);
    expect(r.ir).toEqual({ props: { precision: 'fromPV' } });
  });

  it('carries nothing when every value has a model home', () => {
    const r = mapWidget(node('pv-label', { pv: 'X:RBV', precision: 2, showUnits: true }));
    expect(r.ir).toBeUndefined();
  });

  it('carries a macro where the model wants a number', () => {
    const r = mapWidget(node('pv-progress-bar', { pv: 'X', min: '${LO}', max: 10 }));
    expect(r.props.maxValue).toBe(10);
    expect('minValue' in r.props).toBe(false);
    expect(r.ir).toEqual({ props: { min: '${LO}' } });
  });

  it('records the IR type where several share a builder type', () => {
    expect(mapWidget(node('related-display-button', { file: 'a' })).ir).toEqual({
      type: 'related-display-button',
    });
    expect(mapWidget(node('frame', {})).ir).toEqual({
      type: 'frame',
      synthesized: { layoutMode: 'absolute' },
    });
    // A pv-button is recognisable by its pv; only one without needs the record.
    expect(mapWidget(node('pv-button', { pv: 'X:CMD' })).ir).toBeUndefined();
    expect(mapWidget(node('pv-button', { readbackPV: 'X:STATE' })).ir).toEqual({
      type: 'pv-button',
    });
  });

  it('carries a related display target that is not a usable file name', () => {
    const r = mapWidget(node('related-display-button', { file: '', macros: { A: 'b' } }));
    expect(r.actions).toEqual([]);
    expect(r.ir).toEqual({
      type: 'related-display-button',
      props: { file: '', macros: { A: 'b' } },
    });
  });

  it('keeps an unknown node whole and marks the placeholder props as invented', () => {
    const r = mapWidget(
      node('unknown-widget', { originalClass: 'menuMuxClass', originalProps: { controlPv: 'X' } })
    );
    expect(r.sbType).toBe('Rectangle');
    expect(r.ir?.type).toBe('unknown-widget');
    expect(r.ir?.props).toEqual({
      originalClass: 'menuMuxClass',
      originalProps: { controlPv: 'X' },
    });
    expect(Object.keys(r.ir?.synthesized ?? {}).sort()).toEqual([
      'fill',
      'label',
      'originalClass',
      'originalProps',
    ]);
  });
});
