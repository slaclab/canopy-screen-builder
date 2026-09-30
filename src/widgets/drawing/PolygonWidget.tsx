// Closed polygon (PyDMDrawingIrregularPolygon) / open polygon (polyline) render.
// Render only, shared with the runtime's widget set; there is no vertex editing yet.
import { useMemo } from 'react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

interface Point {
  x: number;
  y: number;
}

export function PolygonWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const lineColor = (props.lineColor as string) ?? '#6f6f6f';
  const lineWidth = (props.lineWidth as number) ?? 2;
  const lineStyle = (props.lineStyle as string) ?? 'solid';
  const closed = (props.closed as boolean) ?? true;
  const fill = (props.fill as boolean) ?? false;
  const fillColor = (props.fillColor as string) ?? lineColor;

  // Points are stored relative to widget layout (0,0 = top-left of widget bounds).
  const rawPoints = props.points as Point[] | undefined;
  const points: Point[] = useMemo(() => {
    if (rawPoints && rawPoints.length >= 2) return rawPoints;
    // Fallback: a triangle spanning the widget bounds so an empty polygon is still visible.
    return [
      { x: layout.width / 2, y: 0 },
      { x: layout.width, y: layout.height },
      { x: 0, y: layout.height },
    ];
  }, [rawPoints, layout.width, layout.height]);

  const pointsAttr = useMemo(() => points.map((p) => `${p.x},${p.y}`).join(' '), [points]);

  const dashArray = useMemo(() => {
    switch (lineStyle) {
      case 'dashed':
        return `${lineWidth * 4} ${lineWidth * 3}`;
      case 'dotted':
        return `${lineWidth} ${lineWidth * 2}`;
      default:
        return undefined;
    }
  }, [lineStyle, lineWidth]);

  const shapeProps = {
    points: pointsAttr,
    fill: fill ? fillColor : 'none',
    stroke: lineColor,
    strokeWidth: lineWidth,
    strokeDasharray: dashArray,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    style: { pointerEvents: 'none' as const },
  };

  return (
    <svg
      className={`polygon-widget ${isSelected ? 'polygon-widget--selected' : ''}`}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{ overflow: 'visible', outline: isSelected ? '2px solid #0f62fe' : 'none' }}
    >
      {closed ? <polygon {...shapeProps} /> : <polyline {...shapeProps} />}
    </svg>
  );
}
