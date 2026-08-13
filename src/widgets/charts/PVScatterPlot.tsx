import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { usePV } from '../../hooks/usePV';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

/**
 * PVScatterPlot — X vs Y scatter of two scalar PVs.
 *
 * On every PV update (either axis), the current (x, y) pair is appended to a
 * bounded history buffer. When both PVs are scalar-valued the plot traces a
 * trajectory of the pair over time; older points fall off once `maxPoints` is
 * reached.
 */
export function PVScatterPlot({ layout, props }: WidgetRendererProps) {
  const xPv = usePV(props.pvNameX as string | undefined);
  const yPv = usePV(props.pvNameY as string | undefined);
  const maxPoints = (props.maxPoints as number) ?? 500;
  const title = props.title as string | undefined;
  const xLabel = props.xLabel as string | undefined;
  const yLabel = props.yLabel as string | undefined;
  const color = (props.color as string) ?? '#0f62fe';

  const [samples, setSamples] = useState<Array<[number, number]>>([]);

  useEffect(() => {
    if (!xPv.connected || !yPv.connected) return;
    if (typeof xPv.value !== 'number' || typeof yPv.value !== 'number') return;
    // Subscription append: each PV re-render feeds a fresh (x, y) into the
    // bounded buffer. This is the pattern the setState-in-effect rule targets,
    // but the update is driven by an external subscription (usePV), not an
    // internal derivation of props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSamples((prev) => {
      const next =
        prev.length >= maxPoints ? prev.slice(prev.length - maxPoints + 1) : prev.slice();
      next.push([xPv.value as number, yPv.value as number]);
      return next;
    });
  }, [xPv.timestamp, yPv.timestamp, xPv.connected, yPv.connected, xPv.value, yPv.value, maxPoints]);

  const option = useMemo(
    () => ({
      backgroundColor: 'transparent',
      animation: false,
      title: title ? { text: title, left: 'center', textStyle: { fontSize: 11 } } : undefined,
      grid: { left: 48, right: 16, top: title ? 32 : 16, bottom: 28 },
      xAxis: {
        type: 'value' as const,
        name: xLabel ?? '',
        scale: true,
        axisLabel: { fontSize: 9 },
      },
      yAxis: {
        type: 'value' as const,
        name: yLabel ?? '',
        scale: true,
        axisLabel: { fontSize: 9 },
      },
      series: [
        {
          type: 'scatter' as const,
          data: samples,
          symbolSize: 4,
          itemStyle: { color },
        },
      ],
    }),
    [samples, title, xLabel, yLabel, color]
  );

  return (
    <div style={{ width: layout.width, height: layout.height, overflow: 'hidden' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'svg' }}
        notMerge
      />
    </div>
  );
}
