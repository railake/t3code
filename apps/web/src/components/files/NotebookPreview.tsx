import type { EnvironmentId, NotebookDocument, ScopedThreadRef } from "@t3tools/contracts";
import "katex/dist/katex.min.css";

import { FileSurfaceNotice } from "./fileSurfaceChrome";
import { NotebookCellView } from "./notebook/NotebookCell";
import { notebookImageBaseDir } from "./notebook/NotebookMarkdown";
import type { NotebookDraftCell } from "./notebookEditorReducer";

/** Read-only notebook renderer for attachments and non-editable documents. */
export function NotebookPreview(props: {
  readonly document: NotebookDocument;
  readonly cwd?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}) {
  const imageBaseDir =
    props.cwd === undefined
      ? undefined
      : notebookImageBaseDir(props.cwd, props.document.relativePath);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {props.document.warnings.map((warning) => (
        <FileSurfaceNotice key={warning}>{warning}</FileSurfaceNotice>
      ))}
      <ol className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-5">
        {props.document.cells.map((cell) => {
          const draft: NotebookDraftCell = { ...cell, clearOutputsOnSave: false };
          return (
            <NotebookCellView
              key={cell.sessionId}
              cell={draft}
              storeKey={`readonly:${props.document.documentId}`}
              relativePath={props.document.relativePath}
              documentLanguage={props.document.language}
              readOnly
              focused={false}
              editing={false}
              {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
              {...(imageBaseDir === undefined ? {} : { imageBaseDir })}
              {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
              {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
              onFocus={() => undefined}
              onRequestEdit={() => undefined}
              onSourceChange={() => undefined}
              onMove={() => undefined}
              onConvert={() => undefined}
              onClearOutputs={() => undefined}
              onDelete={() => undefined}
            />
          );
        })}
      </ol>
    </div>
  );
}
