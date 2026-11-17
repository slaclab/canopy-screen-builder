import { describe, it, expect } from 'vitest';
import { widgetRegistry } from './WidgetRegistry';
import { registerBuiltinWidgets } from './registerBuiltins';

describe('registerBuiltinWidgets', () => {
  registerBuiltinWidgets();

  // These are mapped by the IR importer (irWidgetMap.ts), so an unregistered
  // type would render as nothing on the canvas. Guard against that regressing.
  it.each([
    'PVDropdown',
    'PVCheckbox',
    'PVRadioGroup',
    'PVByteIndicator',
    'PVMeter',
    'Image',
    'PVShellCommand',
    'PVWaveformPlot',
    // Plus the long-standing set, as a sanity check.
    'PVTextDisplay',
    'PVButton',
    'PVLed',
    'Rectangle',
    'Group',
  ] as const)('registers a renderable component for %s', (type) => {
    const def = widgetRegistry.get(type);
    expect(def).toBeDefined();
    expect(def!.component).toBeTypeOf('function');
  });
});
