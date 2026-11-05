// Editor stand-in for an embedded screen (IR `embedded-display`). The builder
// does not load the embedded document, so this draws the frame it occupies
// and names the file it points at — enough to see, select, move and resize
// it. The runtime renders the real content.
import type { WidgetRendererProps } from '../registry/WidgetRegistry';

export function EmbeddedScreenWidget({ layout, props, isSelected }: WidgetRendererProps) {
  const file = typeof props.file === 'string' && props.file !== '' ? props.file : undefined;
  const macros =
    props.macros && typeof props.macros === 'object'
      ? Object.entries(props.macros as Record<string, unknown>)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(', ')
      : '';
  // Small embeds (an EDM symbol is often 20×20) have no room for text; the
  // frame alone still marks the spot, and the tooltip carries the detail.
  const roomForText = layout.width >= 60 && layout.height >= 28;

  return (
    <div
      className="embedded-screen-widget"
      title={[file ?? 'No file set', macros].filter(Boolean).join('\n')}
      style={{
        width: layout.width,
        height: layout.height,
        boxSizing: 'border-box',
        border: `1px dashed ${isSelected ? '#0f62fe' : '#8d8d8d'}`,
        background:
          'repeating-linear-gradient(135deg, rgba(141,141,141,0.10) 0 6px, transparent 6px 12px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        overflow: 'hidden',
        color: '#525252',
        fontSize: 11,
        lineHeight: 1.2,
        textAlign: 'center',
      }}
    >
      {roomForText && (
        <>
          <span style={{ fontWeight: 600 }}>Embedded screen</span>
          <span
            style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 4px',
            }}
          >
            {file ?? 'no file set'}
          </span>
        </>
      )}
    </div>
  );
}
