// READ-ONLY code preview of the one-way TSX eject output.
//
// The canonical save format is the screen IR (`*.screen.json`); TSX is a
// one-way export produced by `generateTSX` for hand-off to React codebases.
// This panel previews that output live as the model changes. The generated
// `.tsx` cannot be re-imported, so the panel must never accept edits.
// (`parseTSX` still powers opening legacy `.tsx` screens via Open File.)

import { useCallback } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import { useEditorStore } from '../model/EditorStore';
import { suggestedBase } from '../model/fileNames';
import { generateTSX } from './generateTSX';
import './CodeEditor.scss';

export function CodeEditor() {
  const screen = useEditorStore((s) => s.screen);
  const filePath = useEditorStore((s) => s.filePath);
  const editorTheme = useEditorStore((s) => s.editorTheme);
  const isDark = editorTheme === 'g90' || editorTheme === 'g100';

  // Regenerated on every model change — Monaco is a controlled, read-only view.
  const currentCode = generateTSX(screen);

  // Suggested eject filename — the same derivation exportCodeFile uses.
  const previewName = `${suggestedBase(filePath, screen.meta.title)}.tsx`;

  const handleEditorMount = useCallback((_editor: unknown, monaco: Monaco) => {
    // Configure TypeScript/TSX defaults so the preview gets highlighting and
    // sensible hovers.
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      jsx: monaco.languages.typescript.JsxEmit.React,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
      esModuleInterop: true,
      strict: true,
    });

    // Add type declarations for our custom types
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      `
        declare module '@pydm/types' {
          export interface ScreenProps {
            title: string;
            width: number;
            height: number;
            backgroundColor: string;
            macros: Record<string, string>;
          }
        }
        declare module '@pydm/runtime' {
          export const Screen: React.FC<{ meta: import('@pydm/types').ScreenProps; macros?: Record<string, string>; children?: React.ReactNode }>;
        }
        declare module '@pydm/hooks' {
          export function usePV(pvName: string): {
            value: number | string;
            displayValue: string;
            severity: number;
            connected: boolean;
            timestamp: number;
            units: string;
            put: (value: number | string) => void;
          };
        }
        declare module '@pydm/widgets' {
          interface PVWidgetProps {
            pv?: string;
            x: number;
            y: number;
            w: number;
            h: number;
            label?: string;
            [key: string]: any;
          }
          export const PVTextDisplay: React.FC<PVWidgetProps>;
          export const PVTextInput: React.FC<PVWidgetProps>;
          export const PVButton: React.FC<PVWidgetProps>;
          export const PVSlider: React.FC<PVWidgetProps>;
          export const PVToggle: React.FC<PVWidgetProps>;
          export const PVLed: React.FC<PVWidgetProps>;
          export const PVProgressBar: React.FC<PVWidgetProps>;
          export const PVDropdown: React.FC<PVWidgetProps>;
          export const PVCheckbox: React.FC<PVWidgetProps>;
          export const PVRadioGroup: React.FC<PVWidgetProps>;
          export const PVSpinbox: React.FC<PVWidgetProps>;
          export const PVMeter: React.FC<PVWidgetProps>;
          export const PVGauge: React.FC<PVWidgetProps>;
          export const PVTank: React.FC<PVWidgetProps>;
          export const PVThermometer: React.FC<PVWidgetProps>;
          export const PVByteIndicator: React.FC<PVWidgetProps>;
        }
        declare module '@pydm/drawing' {
          interface DrawingProps { x: number; y: number; w: number; h: number; [key: string]: any; }
          export const Rectangle: React.FC<DrawingProps>;
          export const Ellipse: React.FC<DrawingProps>;
          export const Line: React.FC<DrawingProps>;
          export const Arc: React.FC<DrawingProps>;
          export const StaticLabel: React.FC<DrawingProps & { text?: string }>;
          export const Image: React.FC<DrawingProps>;
        }
        declare module '@pydm/containers' {
          interface ContainerProps { x: number; y: number; w: number; h: number; children?: React.ReactNode; [key: string]: any; }
          export const Group: React.FC<ContainerProps>;
          export const EmbeddedScreen: React.FC<ContainerProps & { file?: string; macros?: Record<string, string> }>;
        }
        `,
      'file:///pydm-types.d.ts'
    );
  }, []);

  return (
    <div className="code-editor">
      <div className="code-editor__header">
        <span>
          Code preview
          <span className="code-editor__note"> — one-way export; cannot be re-imported</span>
        </span>
        <span className="code-editor__filename">{previewName}</span>
      </div>
      <div className="code-editor__body">
        <Editor
          height="100%"
          defaultLanguage="typescript"
          value={currentCode}
          path="screen.tsx"
          theme={isDark ? 'vs-dark' : 'light'}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'IBM Plex Mono', 'Fira Code', Consolas, monospace",
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 2,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}
