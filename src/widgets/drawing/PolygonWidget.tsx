import { useMemo } from 'react';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

interface Point {
  x: number;
  y: number;
}

function isPoint(v: unknown): v is Point {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Point).x === 'number' &&
    typeof (v as Point).y === 'number'
  );
}

// Vertices of a regular N-gon inscribed in the [0, w] × [0, h] box, first
// vertex at the top so a triangle is point-up.
function regularPolygonPoints(n: number, w: number, h: number): Point[] {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const startAngle = -Math.PI / 2;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const theta = startAngle + (2 * Math.PI * i) / n;
    pts.push({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
  }
  return pts;
}

export function PolygonWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const numPoints = props.numPoints as number | undefined;
  const rawPoints = Array.isArray(props.points) ? (props.points as unknown[]).filter(isPoint) : [];
  const closed = (props.closed as boolean | undefined) ?? true;
  const lineColor = (props.lineColor as string) ?? '#6f6f6f';
  const lineWidth = (props.lineWidth as number) ?? 1;
  const lineStyle = (props.lineStyle as string) ?? 'solid';
  const fill = (props.fill as boolean) ?? false;
  const fillColor = (props.fillColor as string) ?? '#393939';

  // When `numPoints` is set (>= 3), render a regular polygon inscribed in the
  // widget's bounds. Otherwise, fall back to the raw `points` array (imported
  // polygons carry arbitrary vertices from the source screen).
  const points = useMemo(() => {
    if (typeof numPoints === 'number' && numPoints >= 3) {
      return regularPolygonPoints(Math.floor(numPoints), layout.width, layout.height);
    }
    return rawPoints;
  }, [numPoints, rawPoints, layout.width, layout.height]);

  // Bounding box of the point list defines the viewBox; the SVG then scales
  // to fill the widget's layout box, so resizing the widget resizes the shape.
  const { viewBox, pointsStr } = useMemo(() => {
    if (points.length === 0) {
      return { viewBox: `0 0 ${layout.width} ${layout.height}`, pointsStr: '' };
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - minX);
    const h = Math.max(1, Math.max(...ys) - minY);
    return {
      viewBox: `${minX} ${minY} ${w} ${h}`,
      pointsStr: points.map((p) => `${p.x},${p.y}`).join(' '),
    };
  }, [points, layout.width, layout.height]);

  const strokeDasharray =
    lineStyle === 'dashed' ? '6 4' : lineStyle === 'dotted' ? '2 3' : undefined;

  const ShapeTag = closed ? 'polygon' : 'polyline';

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={viewBox}
      preserveAspectRatio="none"
      style={{ overflow: 'visible', outline: isSelected ? '2px solid #0f62fe' : 'none' }}
    >
      {pointsStr && (
        <ShapeTag
          points={pointsStr}
          fill={closed && fill ? fillColor : 'none'}
          stroke={lineColor}
          strokeWidth={lineWidth}
          strokeDasharray={strokeDasharray}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
