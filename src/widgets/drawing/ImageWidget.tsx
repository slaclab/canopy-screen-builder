import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePV } from '../../hooks/usePV';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

const OBJECT_FIT: Record<string, CSSProperties['objectFit']> = {
  none: 'none',
  fit: 'contain',
  fill: 'cover',
  stretch: 'fill',
};

/**
 * Image — one widget, two modes.
 *
 *  - `mode: 'static'` (default): renders `src` as an `<img>`. This is the
 *    ordinary logo / diagram / screenshot use case.
 *  - `mode: 'live'`: reads a waveform PV via `pvName` and, when the value is a
 *    `number[]` of length `imageWidth × imageHeight`, draws it as an 8-bit
 *    grayscale canvas normalized against `imageMin` / `imageMax`. Falls back to
 *    `src` when live data isn't available, and to a labeled placeholder if
 *    neither the PV nor `src` yields a picture.
 */
export function ImageWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const mode = (props.mode as string) === 'live' ? 'live' : 'static';
  const src = props.src as string | undefined;
  const stretchMode = (props.stretchMode as string) ?? 'fit';

  const pv = usePV(mode === 'live' ? (props.pvName as string | undefined) : undefined);
  const imageWidth = (props.imageWidth as number) ?? 0;
  const imageHeight = (props.imageHeight as number) ?? 0;
  const min = (props.imageMin as number) ?? 0;
  const max = (props.imageMax as number) ?? 255;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const hasLiveData =
    mode === 'live' &&
    pv.connected &&
    Array.isArray(pv.value) &&
    imageWidth > 0 &&
    imageHeight > 0 &&
    (pv.value as number[]).length === imageWidth * imageHeight;

  useEffect(() => {
    if (!hasLiveData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = pv.value as number[];
    const img = ctx.createImageData(imageWidth, imageHeight);
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(((data[i] - min) / range) * 255)));
      const o = i * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [hasLiveData, pv.value, imageWidth, imageHeight, min, max]);

  const outline = isSelected ? '2px solid #0f62fe' : 'none';
  const failed = src !== undefined && failedSrc === src;

  if (hasLiveData) {
    return (
      <canvas
        ref={canvasRef}
        width={imageWidth}
        height={imageHeight}
        style={{
          width: layout.width,
          height: layout.height,
          objectFit: OBJECT_FIT[stretchMode] ?? 'contain',
          outline,
          display: 'block',
          imageRendering: 'pixelated',
        }}
      />
    );
  }

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={src}
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

  const placeholderText =
    mode === 'live'
      ? !props.pvName
        ? 'No PV bound'
        : !pv.connected
          ? 'Disconnected'
          : imageWidth <= 0 || imageHeight <= 0
            ? 'Set imageWidth / imageHeight'
            : 'No image data'
      : src
        ? src
        : 'No image';

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
      <span>{mode === 'live' ? '📷' : '🖼'}</span>
      <span style={{ wordBreak: 'break-all' }}>{placeholderText}</span>
    </div>
  );
}
