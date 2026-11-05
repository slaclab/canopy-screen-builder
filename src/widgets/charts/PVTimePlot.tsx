import { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { usePV } from '../../hooks/usePV';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

/**
 * PVTimePlot — rolling strip chart of a single PV over a configurable time
 * window. Samples are captured on each PV update (keyed on `timestamp`) and
 * trimmed to the window on every append. Empty until the first value arrives.
 */
export function PVTimePlot({ layout, props }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const timeWindowSec = (props.timeWindow as number) ?? 60;
  const title = props.title as string | undefined;
  const yLabel = props.yLabel as string | undefined;
  const color = (props.color as string) ?? '#0f62fe';

  const [samples, setSamples] = useState<Array<[number, number]>>([]);

  useEffect(() => {
    if (!pv.connected || typeof pv.value !== 'number' || !pv.timestamp) return;
    // Subscription append: usePV re-renders whenever the underlying PV emits a
    // new snapshot; each new timestamp becomes one point on the plot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSamples((prev) => {
      if (prev.length > 0 && prev[prev.length - 1][0] === pv.timestamp) return prev;
      const cutoff = Date.now() - timeWindowSec * 1000;
      const next: Array<[number, number]> = [];
      for (const s of prev) if (s[0] >= cutoff) next.push(s);
      next.push([pv.timestamp, pv.value as number]);
      return next;
    });
  }, [pv.timestamp, pv.connected, pv.value, timeWindowSec]);

  // Rolling window uses wall-clock time; the plot re-renders on every PV
  // update anyway, so recomputing this per render is intentional.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const option = useMemo(() => {
    const windowMs = timeWindowSec * 1000;
    const xMax = samples.length > 0 ? Math.max(now, samples[samples.length - 1][0]) : now;
    const xMin = xMax - windowMs;
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: title ? { text: title, left: 'center', textStyle: { fontSize: 11 } } : undefined,
      grid: { left: 48, right: 16, top: title ? 32 : 16, bottom: 28 },
      xAxis: {
        type: 'time' as const,
        min: xMin,
        max: xMax,
        axisLabel: { fontSize: 9 },
      },
      yAxis: {
        type: 'value' as const,
        name: yLabel ?? '',
        axisLabel: { fontSize: 9 },
        scale: true,
      },
      series: [
        {
          type: 'line' as const,
          showSymbol: false,
          data: samples,
          lineStyle: { color, width: 1.5 },
          itemStyle: { color },
        },
      ],
    };
  }, [samples, title, yLabel, color, timeWindowSec, now]);

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
