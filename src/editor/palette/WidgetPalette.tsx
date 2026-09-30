import { useState, useCallback } from 'react';
import { Search, Accordion, AccordionItem } from '@carbon/react';
import {
  ChevronDown,
  ChevronLeft,
  TextLongParagraph,
  StringText,
  TouchInteraction,
  ListDropdown,
  Checkbox,
  RadioButton,
  CharacterWholeNumber,
  ToggleOff,
  CircleFilled,
  ProgressBarRound,
  Meter,
  SquareOutline,
  CircleDash,
  HorizontalLineSolid,
  PentagonOutline,
  Label,
  Image,
  GroupObjects,
  Screen,
} from '@carbon/icons-react';
import { widgetRegistry } from '../../widgets/registry/WidgetRegistry';
import type { WidgetDefinition } from '../../widgets/registry/WidgetRegistry';
import type { WidgetType } from '../../types/widget';
import { useEditorStore } from '../model/EditorStore';
import './WidgetPalette.scss';

function SliderIcon({ size }: { size: number }) {
  const cy = size / 2;
  const padding = 2;
  const knobX = size * 0.65;
  const knobR = size * 0.18;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <line
        x1={padding}
        y1={cy}
        x2={size - padding}
        y2={cy}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx={knobX} cy={cy} r={knobR} fill="currentColor" />
    </svg>
  );
}

function ArcIcon({ size }: { size: number }) {
  const r = size / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <path
        d={`M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy - r}`}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Icon mapping ────────────────────────────────────────────────────────────

const WIDGET_ICONS: Partial<Record<WidgetType, React.ComponentType<{ size: number }>>> = {
  PVTextDisplay: TextLongParagraph,
  PVTextInput: StringText,
  PVButton: TouchInteraction,
  PVDropdown: ListDropdown,
  PVCheckbox: Checkbox,
  PVRadioGroup: RadioButton,
  PVSlider: SliderIcon,
  PVSpinbox: CharacterWholeNumber,
  PVToggle: ToggleOff,
  PVLed: CircleFilled,
  PVByteIndicator: Meter,
  PVProgressBar: ProgressBarRound,
  PVMeter: Meter,
  Rectangle: SquareOutline,
  Ellipse: CircleDash,
  Arc: ArcIcon,
  Line: HorizontalLineSolid,
  Polygon: PentagonOutline,
  StaticLabel: Label,
  ScreenImage: Image,
  Group: GroupObjects,
  EmbeddedScreen: Screen,
};

const CATEGORY_LABELS: Record<string, string> = {
  display: 'Display',
  input: 'Input',
  indicator: 'Indicators',
  container: 'Containers',
  chart: 'Charts',
  drawing: 'Drawing',
  navigation: 'Navigation',
};

export function WidgetPalette() {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const allWidgets = widgetRegistry.getAll();
  const categories = widgetRegistry.getCategories();

  const filtered = filter
    ? allWidgets.filter(
        (w) =>
          w.label.toLowerCase().includes(filter.toLowerCase()) ||
          w.type.toLowerCase().includes(filter.toLowerCase())
      )
    : allWidgets;

  const byCategory = categories
    .map((cat) => ({
      category: cat,
      widgets: filtered.filter((w) => w.category === cat),
    }))
    .filter((g) => g.widgets.length > 0);

  return (
    <div className={`widget-palette ${collapsed ? 'widget-palette--collapsed' : ''}`}>
      <div className="widget-palette__header">
        <span>Widgets</span>
        <button
          type="button"
          className="widget-palette__collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand Widgets panel' : 'Collapse Widgets panel'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronLeft size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="widget-palette__search">
            <Search
              size="sm"
              labelText="Filter widgets"
              placeholder="Search widgets..."
              value={filter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
            />
          </div>
          <Accordion size="sm">
            {byCategory.map(({ category, widgets }) => (
              <AccordionItem key={category} title={CATEGORY_LABELS[category] ?? category} open>
                <div className="widget-palette__grid">
                  {widgets.map((def) => (
                    <PaletteItem key={def.type} definition={def} />
                  ))}
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </>
      )}
    </div>
  );
}

function PaletteItem({ definition }: { definition: WidgetDefinition }) {
  const startPaletteDrag = useEditorStore((s) => s.startPaletteDrag);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startPaletteDrag(definition.type);
    },
    [definition.type, startPaletteDrag]
  );

  const IconComponent = WIDGET_ICONS[definition.type];

  return (
    <div className="palette-item" onMouseDown={handleMouseDown} title={definition.label}>
      <div className="palette-item__icon">
        {IconComponent ? <IconComponent size={20} /> : definition.label.charAt(0)}
      </div>
      <div className="palette-item__label">{definition.label}</div>
    </div>
  );
}
