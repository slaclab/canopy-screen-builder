import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';
import { PolygonWidget } from './PolygonWidget';

afterEach(cleanup);

const baseProps: WidgetRendererProps = {
  id: 'poly-1',
  layout: { x: 0, y: 0, width: 100, height: 100 },
  props: {},
  isSelected: false,
} as unknown as WidgetRendererProps;

function renderWith(props: Record<string, unknown>) {
  return render(<PolygonWidget {...baseProps} props={props} />);
}

describe('PolygonWidget', () => {
  it('renders a closed <polygon> with the given points and stroke', () => {
    const { container } = renderWith({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 20, y: 0 },
      ],
      lineColor: '#ff0000',
      lineWidth: 3,
    });
    const poly = container.querySelector('polygon');
    expect(poly).not.toBeNull();
    expect(poly!.getAttribute('points')).toBe('0,0 10,20 20,0');
    expect(poly!.getAttribute('stroke')).toBe('#ff0000');
    expect(poly!.getAttribute('stroke-width')).toBe('3');
    // closed shape, no fill by default
    expect(poly!.getAttribute('fill')).toBe('none');
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders an open <polyline> when closed is false', () => {
    const { container } = renderWith({
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('applies fillColor when fill is enabled', () => {
    const { container } = renderWith({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      fill: true,
      fillColor: '#00ff00',
    });
    expect(container.querySelector('polygon')!.getAttribute('fill')).toBe('#00ff00');
  });

  it('falls back to a triangle when no points are provided', () => {
    const { container } = renderWith({});
    // 3 fallback vertices spanning the 100x100 bounds
    expect(container.querySelector('polygon')!.getAttribute('points')).toBe('50,0 100,100 0,100');
  });
});
