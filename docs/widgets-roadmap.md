# Widgets roadmap

Plan for unifying PyDM + EDM widget coverage in `WIDGET_CATALOG` so operator
screens author once and read cleanly across both source frameworks.

## Design principles

- **One widget per role, not per framework.** Where PyDM and EDM ship
  overlapping widgets (e.g. PyDMLabel + EDM Text Update), the catalog has a
  single `PV…` widget that covers both.
- **Alarms live on the widget, not next to it.** Every PV-bound widget carries
  `alarmSensitiveBorder` / `alarmSensitiveContent` today; keep that model — no
  dedicated "alarm border" widget.
- **Symbols are state → graphic mappings.** One widget covers both PyDMSymbol
  (value → image swap) and EDM Symbol (value → composite drawing).

## Current catalog (main)

| Category    | Widgets                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| PV wrappers | PVTextDisplay, PVTextInput, PVButton, PVShellCommand, PVDropdown, PVCheckbox, PVRadioGroup, PVSlider, PVSpinbox, PVToggle, PVProgressBar, PVTabs |
| Indicators  | PVLed, PVByteIndicator, PVMeter, PVGauge, PVTank, PVThermometer                                                                                  |
| Charts      | PVWaveformPlot                                                                                                                                   |
| Drawings    | Rectangle, Ellipse, Line, Arc, Polygon, StaticLabel, ScreenImage                                                                                 |
| Containers  | Group, EmbeddedScreen                                                                                                                            |

## Proposed additions

Grouped by priority. Each row calls out the PyDM and EDM sources it unifies.

### High priority — core coverage gaps

| Widget                   | PyDM source              | EDM source                      | Notes                                                                                                                                                              |
| ------------------------ | ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PVRelatedDisplayButton` | PyDMRelatedDisplayButton | Related Display                 | Opens another `.screen.json` with macro substitution. Core to multi-screen navigation; both frameworks always ship it.                                             |
| `PVSymbol`               | PyDMSymbol               | Symbol                          | Value → state → graphic. State graphic is either an image path or a reference to a nested drawing group defined on the screen. Alarm props flow through unchanged. |
| `PVTimePlot`             | PyDMTimePlot             | (built via generic plot in EDM) | Strip chart. Echarts-based, mirroring PVWaveformPlot's structure.                                                                                                  |
| `PVImageView`            | PyDMImageView            | Image                           | Live image from an areaDetector-style PV.                                                                                                                          |

### Medium priority — useful but not blocking

| Widget                                           | PyDM source         | EDM source    | Notes                                                                                                            |
| ------------------------------------------------ | ------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PVScatterPlot`                                  | PyDMScatterPlot     | —             | XY scatter. Reuse echarts-for-react.                                                                             |
| `PVAlarmSummary`                                 | (hand-rolled)       | (hand-rolled) | Aggregates severity across a PV list into one colored chip. Every operator screen builds one — worth doing once. |
| `Polyline` _(or `closed: boolean` on `Polygon`)_ | PyDMDrawingPolyline | Polyline      | Open multi-point path. Extending Polygon with `closed` keeps the widget count down.                              |

### Low priority — parity with heavy PyDM installs

| Widget             | PyDM source          | EDM source | Notes                                                  |
| ------------------ | -------------------- | ---------- | ------------------------------------------------------ |
| `PVArchiverPlot`   | PyDMArchiverTimePlot | —          | Historical time-series (needs archiver appliance URL). |
| `TemplateRepeater` | PyDMTemplateRepeater | —          | Loops a sub-screen over a list of macros. Advanced.    |

## Alarms

Not new widgets. Every PV-bound widget already exposes:

- `alarmSensitiveBorder: boolean` — border color reflects severity
- `alarmSensitiveContent: boolean` — content color reflects severity

New widgets in this roadmap should honor both props at parity with existing
widgets. `PVAlarmSummary` is the only alarm-oriented widget itself, and it's
an aggregator, not a rendering mode.

## Symbols

`PVSymbol` is the widget that bridges the biggest PyDM/EDM feature gap.

- **State definition.** `states: Array<{ min?: number; max?: number; enum?: string; graphic: SymbolGraphic }>`. The first matching state wins.
- **Graphic types.** Either `{ kind: 'image'; src: string }` (PyDMSymbol) or
  `{ kind: 'group'; groupId: string }` referencing a nested drawing group in
  the same screen (EDM Symbol composite behavior).
- **Fallback.** A `defaultGraphic` renders when no state matches (e.g. PV
  disconnected).
- **Alarm sensitivity** flows through the standard props; the graphic itself
  is unaffected — only the surrounding border/tint.

## Suggested implementation order

1. `PVRelatedDisplayButton` — highest daily-use value, moderate complexity.
2. `Polygon.closed` prop (folds Polyline in) — one-line addition, warms up the
   drawing widget surface.
3. `PVSymbol` — the signature EDM feature; sizing the design here defines the
   pattern for state-driven widgets going forward.
4. `PVTimePlot` — mirrors PVWaveformPlot's echarts setup.
5. `PVImageView` — new widget class (video/image), design decisions around
   subscription rate.
6. `PVAlarmSummary`, `PVScatterPlot` — quick wins once the pattern is set.
7. `PVArchiverPlot`, `TemplateRepeater` — later, once the archiver appliance
   integration is scoped.
