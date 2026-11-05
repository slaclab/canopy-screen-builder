// Summarizes the outcome of the last screen import — what was unknown,
// degraded, or dropped — so a lossy import is never silent. Also surfaces
// save/export failures. Driven entirely by `lastImportReport` / `importError`
// / `saveError` on the editor store.

import { Modal, UnorderedList, ListItem } from '@carbon/react';
import { useEditorStore } from '../model/EditorStore';
import { useLastImportReport, useImportError, useSaveError } from '../model/hooks';

export function ImportReportModal() {
  const report = useLastImportReport();
  const error = useImportError();
  const saveError = useSaveError();
  const clear = useEditorStore((s) => s.clearImportReport);

  // Save-error path: the screen failed IR validation on export. No file was
  // written; the canvas is untouched.
  if (saveError) {
    return (
      <Modal open passiveModal danger modalHeading="Save failed" onRequestClose={clear} size="sm">
        <p>The screen could not be saved. No file was written.</p>
        <UnorderedList>
          {saveError.map((msg, i) => (
            <ListItem key={i}>{msg}</ListItem>
          ))}
        </UnorderedList>
      </Modal>
    );
  }

  // Error path: validation/converter failure. The screen was NOT replaced.
  if (error) {
    return (
      <Modal open passiveModal danger modalHeading="Import failed" onRequestClose={clear} size="sm">
        <p>The screen could not be imported. The current canvas was left unchanged.</p>
        <UnorderedList>
          {error.map((msg, i) => (
            <ListItem key={i}>{msg}</ListItem>
          ))}
        </UnorderedList>
      </Modal>
    );
  }

  if (!report) return null;

  const clean =
    report.unknownWidgets.length === 0 &&
    report.degradedWidgets.length === 0 &&
    report.droppedProps.length === 0 &&
    report.droppedRules.length === 0 &&
    report.keptRules.length === 0 &&
    report.warnings.length === 0;

  return (
    <Modal open passiveModal modalHeading="Import report" onRequestClose={clear} size="md">
      {clean ? (
        <p>Screen imported cleanly — every widget mapped with no loss.</p>
      ) : (
        <>
          {report.unknownWidgets.length > 0 && (
            <Section title="Unknown widgets (rendered as placeholders)">
              {report.unknownWidgets.map((u) => (
                <ListItem key={u.originalClass}>
                  {u.originalClass} × {u.count}
                </ListItem>
              ))}
            </Section>
          )}
          {report.degradedWidgets.length > 0 && (
            <Section title="Degraded widgets">
              {report.degradedWidgets.map((d) => (
                <ListItem key={d.widgetId}>
                  {d.type} ({d.widgetId}): {d.reason}
                </ListItem>
              ))}
            </Section>
          )}
          {report.droppedRules.length > 0 && (
            <Section title="Dropped rules">
              {report.droppedRules.map((r, i) => (
                <ListItem key={i}>{r}</ListItem>
              ))}
            </Section>
          )}
          {report.keptRules.length > 0 && (
            <Section title="Rules kept but not editable">
              {report.keptRules.map((r, i) => (
                <ListItem key={i}>{r}</ListItem>
              ))}
            </Section>
          )}
          {report.droppedProps.length > 0 && (
            <Section title="Dropped properties">
              {report.droppedProps.map((p) => (
                <ListItem key={p.widgetId}>
                  {p.type} ({p.widgetId}): {p.keys.join(', ')}
                </ListItem>
              ))}
            </Section>
          )}
          {report.warnings.length > 0 && (
            <Section title="Warnings">
              {report.warnings.map((w, i) => (
                <ListItem key={i}>{w}</ListItem>
              ))}
            </Section>
          )}
        </>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <h6 style={{ marginBottom: '0.25rem' }}>{title}</h6>
      <UnorderedList>{children}</UnorderedList>
    </div>
  );
}
