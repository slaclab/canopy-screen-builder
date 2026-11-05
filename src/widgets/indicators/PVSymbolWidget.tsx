import { useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { usePV } from '../../hooks/usePV';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

interface SymbolState {
  value: number | string;
  src?: string;
  label?: string;
}

function isSymbolState(v: unknown): v is SymbolState {
  if (typeof v !== 'object' || v === null) return false;
  const t = typeof (v as SymbolState).value;
  return t === 'number' || t === 'string';
}

const OBJECT_FIT: Record<string, CSSProperties['objectFit']> = {
  none: 'none',
  fit: 'contain',
  fill: 'cover',
  stretch: 'fill',
};

/**
 * PVSymbol — value-driven image swap.
 *
 * Reads `pvName`, matches its value against `states[]` by strict equality, and
 * renders that state's `src`. When no state matches (or the PV is disconnected)
 * it falls back to `defaultSrc`. Missing images render as a labeled placeholder
 * so state changes are visible even before real image assets are wired in.
 */
export function PVSymbolWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const states = Array.isArray(props.states)
    ? (props.states as unknown[]).filter(isSymbolState)
    : [];
  const defaultSrc = props.defaultSrc as string | undefined;
  const stretchMode = (props.stretchMode as string) ?? 'fit';

  const active = useMemo(() => {
    if (!pv.connected) return null;
    for (const s of states) {
      if (s.value === pv.value) return s;
    }
    return null;
  }, [pv.connected, pv.value, states]);

  const src = active?.src ?? defaultSrc;
  const label = active?.label ?? (active ? String(active.value) : undefined);

  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== undefined && failedSrc === src;

  const outline = isSelected ? '2px solid #0f62fe' : 'none';

  if (!src || failed) {
    // Placeholder — shows current state label / value or a "no PV" hint.
    const placeholderText = !props.pvName
      ? 'No PV bound'
      : !pv.connected
        ? 'Disconnected'
        : label !== undefined
          ? label
          : 'No matching state';
    return (
      <div
        style={{
          width: layout.width,
          height: layout.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          border: '1px dashed #6f6f6f',
          borderRadius: 2,
          color: '#8d8d8d',
          fontSize: 11,
          textAlign: 'center',
          overflow: 'hidden',
          padding: 4,
          boxSizing: 'border-box',
          outline,
          userSelect: 'none',
        }}
      >
        <span>◈</span>
        <span style={{ wordBreak: 'break-all' }}>{placeholderText}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={label ?? src}
      onError={() => setFailedSrc(src)}
      style={{
        width: layout.width,
        height: layout.height,
        objectFit: OBJECT_FIT[stretchMode] ?? 'contain',
        outline,
        display: 'block',
      }}
    />
  );
}
