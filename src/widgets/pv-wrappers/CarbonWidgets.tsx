import { useState, useCallback } from 'react';
import {
  TextInput,
  Slider,
  Toggle,
  ProgressBar,
  Tag,
  Dropdown,
  Checkbox,
  RadioButtonGroup,
  RadioButton,
} from '@carbon/react';
import { Terminal, Launch } from '@carbon/icons-react';
import { usePV } from '../../hooks/usePV';
import { alarmBorderStyle } from '../../theme/alarm';
import { AlarmSeverity, AlarmSeverityName } from '../../types/widget';
import type { WidgetRendererProps } from '../registry/WidgetRegistry';
import { useFitText } from '../shared/useFitText';
import './CarbonWidgets.scss';

/** PVTextDisplay — Carbon Tag/Text showing live PV value */
export function CarbonPVTextDisplay({ layout, props, isSelected }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const alarmBorder = alarmBorderStyle(
    pv.severity,
    (props.alarmSensitiveBorder as boolean) ?? true
  );

  const label = props.label as string | undefined;
  const value = pv.connected ? pv.displayValue : '---';
  // Default ~13px matches the .carbon-pv-display__value rule (0.8125rem).
  const maxFontSize = (props.fontSize as number) ?? 13;
  const { ref, fontSize } = useFitText<HTMLDivElement>(maxFontSize, [
    label,
    value,
    layout.width,
    layout.height,
  ]);

  const severityTag = (() => {
    switch (pv.severity) {
      case AlarmSeverity.MINOR:
        return 'magenta' as const;
      case AlarmSeverity.MAJOR:
        return 'red' as const;
      case AlarmSeverity.INVALID:
        return 'purple' as const;
      case AlarmSeverity.DISCONNECTED:
        return 'gray' as const;
      default:
        return 'green' as const;
    }
  })();

  return (
    <div
      className={`carbon-pv-display ${isSelected ? 'carbon-pv-display--selected' : ''}`}
      style={{
        width: layout.width,
        height: layout.height,
        ...alarmBorder,
      }}
    >
      <div ref={ref} className="carbon-pv-display__content" style={{ fontSize }}>
        {label && <span className="carbon-pv-display__label">{label}</span>}
        <span className="carbon-pv-display__value">{value}</span>
      </div>
      {pv.connected && pv.severity !== AlarmSeverity.NO_ALARM && (
        <Tag size="sm" type={severityTag} className="carbon-pv-display__alarm-tag">
          {AlarmSeverityName[pv.severity]}
        </Tag>
      )}
    </div>
  );
}

/** PVTextInput — Carbon TextInput bound to PV */
export function CarbonPVTextInput({
  id,
  layout,
  props,
  isSelected,
  isEditing,
}: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const alarmBorder = alarmBorderStyle(
    pv.severity,
    (props.alarmSensitiveBorder as boolean) ?? true
  );

  const handleBlur = useCallback(() => {
    if (draft !== null && pv.connected) {
      const numVal = parseFloat(draft);
      pv.put(isNaN(numVal) ? draft : numVal);
      setDraft(null);
    }
  }, [draft, pv]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleBlur();
      if (e.key === 'Escape') setDraft(null);
    },
    [handleBlur]
  );

  return (
    <div
      className={`carbon-pv-input ${isSelected ? 'carbon-pv-input--selected' : ''}`}
      style={{ width: layout.width, height: layout.height, ...alarmBorder }}
    >
      <TextInput
        id={`pv-input-${id}`}
        labelText={(props.label as string) ?? ''}
        hideLabel={!props.label}
        size="sm"
        value={draft ?? (pv.connected ? String(pv.value) : '---')}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={!pv.connected && !!props.pvName}
        readOnly={isEditing}
      />
    </div>
  );
}

/** PVButton — push or toggle button writing to a Control PV */
export function CarbonPVButton({ layout, props, isEditing }: WidgetRendererProps) {
  // Control binding is the registry-wide `pvName` key (the IR's `pv` on save).
  const controlPV = usePV(props.pvName as string | undefined);
  const readbackPV = usePV(props.readbackPV as string | undefined);
  const colorPV = usePV(props.colorPV as string | undefined);
  const visibilityPV = usePV(props.visibilityPV as string | undefined);

  const buttonType = (props.buttonType as 'push' | 'toggle') ?? 'push';
  const labelType = (props.labelType as 'literal' | 'pvState') ?? 'literal';
  const onLabel = (props.onLabel as string) ?? 'On';
  const offLabel = (props.offLabel as string) ?? 'Off';
  const invisible = props.invisible === true;
  const fontFamily = (props.fontFamily as string) || 'IBM Plex Sans, sans-serif';
  const fontSize = (props.fontSize as number) ?? 13;
  const foregroundColor = (props.foregroundColor as string) ?? '#ffffff';
  const baseBg = (props.backgroundColor as string) ?? '#0f62fe';

  const isOn =
    readbackPV.connected &&
    (typeof readbackPV.value === 'number' ? readbackPV.value !== 0 : Boolean(readbackPV.value));

  const handleClick = useCallback(() => {
    if (isEditing || !controlPV.address) return;
    if (buttonType === 'toggle') {
      controlPV.put(isOn ? 0 : 1);
    } else {
      controlPV.put(1);
    }
  }, [isEditing, controlPV, buttonType, isOn]);

  // Visibility PV: hide at runtime when its value is falsy
  if (!isEditing && props.visibilityPV && visibilityPV.connected) {
    const visible =
      typeof visibilityPV.value === 'number'
        ? visibilityPV.value !== 0
        : Boolean(visibilityPV.value);
    if (!visible) return null;
  }
  // Invisible toggle: hide at runtime, dim in editor
  if (!isEditing && invisible) return null;

  const backgroundColor =
    props.colorPV && colorPV.connected && typeof colorPV.value === 'string'
      ? colorPV.value
      : baseBg;

  let label: string;
  if (labelType === 'pvState') {
    label = readbackPV.connected ? String(readbackPV.value ?? '') : '';
  } else {
    label = isOn ? onLabel : offLabel;
  }

  return (
    <button
      onClick={handleClick}
      style={{
        width: layout.width,
        height: layout.height,
        backgroundColor,
        color: foregroundColor,
        fontFamily,
        fontSize,
        border: 'none',
        borderRadius: 2,
        cursor: isEditing ? 'default' : 'pointer',
        opacity: invisible ? 0.35 : 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}

/** PVShellCommand — button that runs a shell command on click */
export function CarbonPVShellCommand({ layout, props, isEditing }: WidgetRendererProps) {
  const command = (props.command as string) ?? '';
  const label = (props.label as string) || 'Run';
  const showIcon = props.showIcon === true;
  const fontFamily = (props.fontFamily as string) || 'IBM Plex Sans, sans-serif';
  const fontSize = (props.fontSize as number) ?? 13;
  const foregroundColor = (props.foregroundColor as string) ?? '#161616';
  const backgroundColor = (props.backgroundColor as string) ?? '#bbbbbb';

  const handleClick = useCallback(() => {
    // In edit mode the widget is inert (like the other editor widgets). Live
    // shell execution is a follow-up; the command is preserved on the widget
    // (surfaced via the button tooltip) so it round-trips through save/open.
    if (isEditing || !command) return;
  }, [isEditing, command]);

  return (
    <button
      onClick={handleClick}
      title={command || undefined}
      style={{
        width: layout.width,
        height: layout.height,
        backgroundColor,
        color: foregroundColor,
        fontFamily,
        fontSize,
        border: 'none',
        borderRadius: 2,
        cursor: isEditing ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 0,
      }}
    >
      {showIcon && <Terminal size={16} />}
      {label}
    </button>
  );
}

/** PVRelatedDisplayButton — button that opens another screen file with macros. */
export function CarbonPVRelatedDisplayButton({ layout, props, isEditing }: WidgetRendererProps) {
  const file = (props.file as string) ?? '';
  const label = (props.label as string) || 'Open';
  const showIcon = props.showIcon !== false;
  const target = (props.target as string) ?? 'window';
  const fontFamily = (props.fontFamily as string) || 'IBM Plex Sans, sans-serif';
  const fontSize = (props.fontSize as number) ?? 13;
  const foregroundColor = (props.foregroundColor as string) ?? '#161616';
  const backgroundColor = (props.backgroundColor as string) ?? '#bbbbbb';

  // In edit mode the widget is inert. Live navigation is a runtime concern;
  // the file/macros/target props are preserved for the runtime to interpret.
  const handleClick = useCallback(() => {
    if (isEditing || !file) return;
  }, [isEditing, file]);

  const tooltip = file
    ? `${target === 'tab' ? 'tab' : target === 'replace' ? 'replace' : 'window'}: ${file}`
    : undefined;

  return (
    <button
      onClick={handleClick}
      title={tooltip}
      style={{
        width: layout.width,
        height: layout.height,
        backgroundColor,
        color: foregroundColor,
        fontFamily,
        fontSize,
        border: 'none',
        borderRadius: 2,
        cursor: isEditing ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 0,
      }}
    >
      {showIcon && <Launch size={16} />}
      {label}
    </button>
  );
}

/** PVSlider — Carbon Slider bound to PV */
export function CarbonPVSlider({ id, layout, props, isSelected, isEditing }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const min = (props.minValue as number) ?? pv.lowerLimit ?? 0;
  const max = (props.maxValue as number) ?? pv.upperLimit ?? 100;
  const value = pv.connected ? (typeof pv.value === 'number' ? pv.value : 0) : 0;

  const handleChange = useCallback(
    ({ value: v }: { value: number }) => {
      if (!isEditing) pv.put(v);
    },
    [isEditing, pv]
  );

  return (
    <div
      className={`carbon-pv-slider ${isSelected ? 'carbon-pv-slider--selected' : ''}`}
      style={{ width: layout.width, height: layout.height }}
    >
      <Slider
        id={`pv-slider-${id}`}
        labelText=""
        hideTextInput
        min={min}
        max={max}
        value={value}
        onChange={handleChange}
        disabled={!pv.connected && !!props.pvName}
      />
    </div>
  );
}

/** PVToggle — Carbon Toggle bound to PV */
export function CarbonPVToggle({ id, layout, props, isEditing }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const isOn = pv.connected && (typeof pv.value === 'number' ? pv.value !== 0 : Boolean(pv.value));

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!isEditing) pv.put(checked ? 1 : 0);
    },
    [isEditing, pv]
  );

  return (
    <div
      style={{ width: layout.width, height: layout.height, display: 'flex', alignItems: 'center' }}
    >
      <Toggle
        id={`pv-toggle-${id}`}
        labelText=""
        hideLabel
        size="sm"
        toggled={isOn}
        onToggle={handleToggle}
        labelA={(props.offLabel as string) ?? 'Off'}
        labelB={(props.onLabel as string) ?? 'On'}
        disabled={!pv.connected && !!props.pvName}
      />
    </div>
  );
}

/** PVProgressBar — Carbon ProgressBar bound to PV */
export function CarbonPVProgressBar({ layout, props, isSelected }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const min = (props.minValue as number) ?? 0;
  const max = (props.maxValue as number) ?? 100;
  const value = pv.connected ? (typeof pv.value === 'number' ? pv.value : 0) : 0;
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const status = (() => {
    if (!pv.connected) return 'error' as const;
    if (pv.severity === AlarmSeverity.MAJOR) return 'error' as const;
    return 'active' as const;
  })();

  return (
    <div
      className={`carbon-pv-progress ${isSelected ? 'carbon-pv-progress--selected' : ''}`}
      style={{ width: layout.width, height: layout.height }}
    >
      <ProgressBar
        label={(props.label as string) ?? ''}
        hideLabel={!props.label}
        value={percent}
        status={status}
        size="small"
      />
    </div>
  );
}

/** PVLed — Custom LED indicator (no Carbon equivalent) */
export function CarbonPVLed({ layout, props }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const isOn = pv.connected && (typeof pv.value === 'number' ? pv.value !== 0 : Boolean(pv.value));
  const onColor = (props.onColor as string) ?? '#24a148';
  const offColor = (props.offColor as string) ?? '#525252';
  const color = isOn ? onColor : offColor;
  const size = Math.min(layout.width, layout.height);

  return (
    <div
      className="carbon-pv-led"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: isOn
          ? `0 0 ${size / 2}px ${color}80, inset 0 -2px 4px rgba(0,0,0,0.3)`
          : 'inset 0 2px 4px rgba(0,0,0,0.4)',
        transition: 'background-color 0.2s, box-shadow 0.2s',
        border: `1px solid rgba(255,255,255,0.1)`,
      }}
    >
      {/* Highlight reflection */}
      <div
        style={{
          width: size * 0.35,
          height: size * 0.35,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255,255,255,${isOn ? 0.4 : 0.15}) 0%, transparent 70%)`,
          position: 'relative',
          top: size * 0.12,
          left: size * 0.15,
        }}
      />
    </div>
  );
}

/** PVDropdown — Carbon Dropdown bound to PV */
export function CarbonPVDropdown({ id, layout, props, isEditing }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const items = (props.customItems as string[]) ?? ['Option 1', 'Option 2', 'Option 3'];

  return (
    <div style={{ width: layout.width, height: layout.height }}>
      <Dropdown
        id={`pv-dropdown-${id}`}
        titleText=""
        label={pv.connected ? String(pv.value) : 'Select...'}
        items={items}
        itemToString={(item: string) => item}
        size="sm"
        disabled={!pv.connected && !!props.pvName}
        onChange={({ selectedItem }: { selectedItem: string | null }) => {
          if (!isEditing && selectedItem) pv.put(selectedItem);
        }}
      />
    </div>
  );
}

/** PVCheckbox — Carbon Checkbox bound to PV (writes 1/0) */
export function CarbonPVCheckbox({ id, layout, props, isEditing }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const isChecked =
    pv.connected && (typeof pv.value === 'number' ? pv.value !== 0 : Boolean(pv.value));

  const handleChange = useCallback(
    (_: unknown, { checked }: { checked: boolean }) => {
      if (!isEditing) pv.put(checked ? 1 : 0);
    },
    [isEditing, pv]
  );

  return (
    <div
      style={{ width: layout.width, height: layout.height, display: 'flex', alignItems: 'center' }}
    >
      <Checkbox
        id={`pv-checkbox-${id}`}
        labelText={(props.label as string) ?? ''}
        checked={isChecked}
        onChange={handleChange}
        disabled={!pv.connected && !!props.pvName}
        readOnly={isEditing}
      />
    </div>
  );
}

/** PVByteIndicator — a row of LED dots, one per bit of the PV value */
export function CarbonPVByteIndicator({ layout, props }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const value = pv.connected && typeof pv.value === 'number' ? pv.value : 0;
  const numBits = Math.max(1, (props.numBits as number) ?? 8);
  const startBit = (props.startBit as number) ?? 0;
  const bigEndian = (props.bigEndian as boolean) ?? false;
  const onColor = (props.onColor as string) ?? '#24a148';
  const offColor = (props.offColor as string) ?? '#525252';

  // Each cell is a square sized to the row height; lay them out left→right.
  const size = Math.min(layout.height, layout.width / numBits);

  const bits = Array.from({ length: numBits }, (_, i) => {
    // Bit 0 is the LSB. bigEndian renders the high bit first (leftmost).
    const bitIndex = bigEndian ? numBits - 1 - i : i;
    return (value >> (startBit + bitIndex)) & 1;
  });

  return (
    <div
      className="carbon-pv-byte"
      style={{
        width: layout.width,
        height: layout.height,
        display: 'flex',
        gap: 2,
        alignItems: 'center',
      }}
    >
      {bits.map((on, i) => {
        const color = on ? onColor : offColor;
        return (
          <div
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              backgroundColor: color,
              boxShadow: on
                ? `0 0 ${size / 3}px ${color}80, inset 0 -1px 2px rgba(0,0,0,0.3)`
                : 'inset 0 1px 2px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.1)',
              flex: '0 0 auto',
            }}
          />
        );
      })}
    </div>
  );
}

/** PVRadioGroup — Carbon RadioButtonGroup bound to an enum PV */
export function CarbonPVRadioGroup({ id, layout, props, isEditing }: WidgetRendererProps) {
  const pv = usePV(props.pvName as string | undefined);
  const alarmBorder = alarmBorderStyle(
    pv.severity,
    (props.alarmSensitiveBorder as boolean) ?? false
  );
  const items = (props.customItems as string[]) ?? ['Option 1', 'Option 2', 'Option 3'];
  const orientation = (props.orientation as 'horizontal' | 'vertical') ?? 'vertical';
  const valueSelected = pv.connected ? String(pv.value) : undefined;
  const disabled = !pv.connected && !!props.pvName;

  const handleChange = useCallback(
    (selection: string | number | undefined) => {
      if (!isEditing && (typeof selection === 'string' || typeof selection === 'number')) {
        pv.put(String(selection));
      }
    },
    [isEditing, pv]
  );

  return (
    <div style={{ width: layout.width, height: layout.height, overflow: 'hidden', ...alarmBorder }}>
      <RadioButtonGroup
        name={`pv-radio-${id}`}
        legendText={(props.label as string) ?? ''}
        orientation={orientation}
        valueSelected={valueSelected}
        onChange={handleChange}
        disabled={disabled}
        readOnly={isEditing}
      >
        {items.map((item) => (
          <RadioButton
            key={item}
            id={`pv-radio-${id}-${item}`}
            labelText={item}
            value={item}
            disabled={disabled}
          />
        ))}
      </RadioButtonGroup>
    </div>
  );
}
