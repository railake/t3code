import { Editor } from "@pierre/diffs/editor";
import { EditProvider, File } from "@pierre/diffs/react";
import { useEffect, useEffectEvent, useState } from "react";

import { DiffWorkerPoolProvider } from "~/components/DiffWorkerPoolProvider";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { FILE_LINK_REVEAL_UNSAFE_CSS } from "../fileSurfaceChrome";
import { notebookCellEditorCacheKey, notebookCellFileName } from "./notebookCellFile";

/**
 * Pierre owns in-cell undo/redo. Structural cell insert/delete/move undo lives
 * in the notebook editor store — do not mix the two stacks.
 *
 * One Editor instance is shared for the notebook surface. `persistState` + a
 * stable-per-cell cacheKey keeps undo history across focus swaps (see
 * `notebookCellEditorCacheKey`).
 */
export function NotebookCodeEditor(props: {
  readonly storeKey: string;
  readonly relativePath: string;
  readonly sessionId: string;
  readonly cellType: "code" | "markdown" | "raw";
  readonly language: string | undefined;
  readonly documentLanguage: string | undefined;
  readonly source: string;
  readonly onChange: (source: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const handleChange = useEffectEvent((source: string) => props.onChange(source));

  const [editor] = useState(
    () =>
      new Editor({
        persistState: true,
        persistStateStorage: "inMemory",
        onChange: (file) => {
          handleChange(file.contents);
        },
      }),
  );

  useEffect(
    () => () => {
      editor.cleanUp();
    },
    [editor],
  );

  const fileName = notebookCellFileName(
    props.relativePath,
    {
      sessionId: props.sessionId,
      cellType: props.cellType,
      ...(props.language === undefined ? {} : { language: props.language }),
    },
    props.documentLanguage,
  );
  const cacheKey = notebookCellEditorCacheKey(
    props.storeKey,
    props.sessionId,
    props.source,
    editor.getFile() ?? undefined,
  );

  return (
    <div data-notebook-cell-editor="" className="min-h-[1.5rem] min-w-0">
      <DiffWorkerPoolProvider>
        <EditProvider editor={editor}>
          <File
            file={{
              name: fileName,
              contents: props.source,
              cacheKey,
            }}
            options={{
              disableFileHeader: true,
              overflow: wordWrap ? "wrap" : "scroll",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
            }}
            className="min-h-[1.5rem]"
            contentEditable
          />
        </EditProvider>
      </DiffWorkerPoolProvider>
    </div>
  );
}
