import type { EnvironmentId, NotebookDocument, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { FileSurfaceNotice } from "../fileSurfaceChrome";
import { projectFileCacheKey } from "../fileContentRevision";
import {
  notebookSavePayloadFromStore,
  useNotebookSaveCoordinator,
} from "../notebookSaveCoordinator";
import {
  notebookEditorStoreKey,
  selectNotebookEditorSession,
  useNotebookEditorStore,
} from "../notebookEditorStore";
import SourceFilePreview from "../ReadOnlySourcePreview";
import { useProjectFileQuery } from "../projectFilesQueryState";
import { NotebookCellView } from "./NotebookCell";
import { notebookImageBaseDir } from "./NotebookMarkdown";
import { NotebookToolbar } from "./NotebookToolbar";
import {
  isNotebookKeyIgnoredTarget,
  resolveNotebookKeymap,
  type NotebookKeymapAction,
} from "./notebookKeymap";
import {
  notebookCollapsedSessionIds,
  notebookHeadingLevel,
  notebookMetadataWithSectionCollapsed,
  NOTEBOOK_OUTLINE_STORAGE_KEY,
  notebookSectionIsCollapsed,
  notebookUsesColabMetadata,
  useNotebookOutline,
} from "./notebookOutline";
import { readNotebookCellCaretOffset } from "./notebookCellCaret";
import { notebookSaveStatus } from "./notebookToolbarState";

export function NotebookSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly document: NotebookDocument;
  readonly threadRef?: ScopedThreadRef;
  readonly readOnly: boolean;
  readonly onPendingChange: (relativePath: string, pending: boolean) => void;
}) {
  const key = notebookEditorStoreKey(props.environmentId, props.cwd, props.relativePath);
  const ensure = useNotebookEditorStore((state) => state.ensure);
  const replaceIfClean = useNotebookEditorStore((state) => state.replaceIfClean);
  const session = useNotebookEditorStore(selectNotebookEditorSession(key));
  const insertCell = useNotebookEditorStore((state) => state.insertCell);
  const deleteCell = useNotebookEditorStore((state) => state.deleteCell);
  const moveCell = useNotebookEditorStore((state) => state.moveCell);
  const setSource = useNotebookEditorStore((state) => state.setSource);
  const setCellMetadata = useNotebookEditorStore((state) => state.setCellMetadata);
  const setCellType = useNotebookEditorStore((state) => state.setCellType);
  const clearOutputs = useNotebookEditorStore((state) => state.clearOutputs);
  const splitCellAt = useNotebookEditorStore((state) => state.splitCellAt);
  const mergeWithBelow = useNotebookEditorStore((state) => state.mergeWithBelow);
  const undo = useNotebookEditorStore((state) => state.undo);
  const redo = useNotebookEditorStore((state) => state.redo);
  const focus = useNotebookEditorStore((state) => state.focus);
  const setMode = useNotebookEditorStore((state) => state.setMode);
  const reloadFromDisk = useNotebookEditorStore((state) => state.reloadFromDisk);
  const keepMine = useNotebookEditorStore((state) => state.keepMine);

  const [pending, setPending] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [outlineOpen, setOutlineOpen] = useLocalStorage(
    NOTEBOOK_OUTLINE_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [localCollapsed, setLocalCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const pendingDeleteRef = useRef(false);
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const saveCoordinator = useNotebookSaveCoordinator({
    environmentId: props.environmentId,
    cwd: props.cwd,
    relativePath: props.relativePath,
    onPendingChange: (relativePath, nextPending) => {
      setPending(nextPending);
      props.onPendingChange(relativePath, nextPending);
    },
  });

  useEffect(() => {
    ensure(key, props.document);
  }, [ensure, key, props.document]);

  useEffect(() => {
    replaceIfClean(key, props.document);
  }, [key, props.document, replaceIfClean]);

  const queueSave = useCallback(() => {
    if (props.readOnly) return;
    const payload = notebookSavePayloadFromStore(key);
    if (payload !== null) saveCoordinator.change(payload);
  }, [key, props.readOnly, saveCoordinator]);

  const applySource = useCallback(
    (sessionId: string, source: string) => {
      setSource(key, sessionId, source);
      queueSave();
    },
    [key, queueSave, setSource],
  );

  const runAction = useCallback(
    (action: NotebookKeymapAction) => {
      if (props.readOnly && action.type !== "focus-prev" && action.type !== "focus-next") return;
      const focused = session?.focusedSessionId ?? null;
      switch (action.type) {
        case "enter-edit":
          if (focused) focus(key, focused, "edit");
          break;
        case "enter-command":
          setMode(key, "command");
          break;
        case "insert-above":
          insertCell(key, {
            relativeToSessionId: focused,
            position: "before",
            cellType: "code",
          });
          queueSave();
          break;
        case "insert-below":
          insertCell(key, {
            relativeToSessionId: focused,
            position: "after",
            cellType: "code",
          });
          queueSave();
          break;
        case "delete-cell":
          if (focused) {
            deleteCell(key, focused);
            queueSave();
          }
          break;
        case "convert-markdown":
          if (focused) {
            setCellType(key, focused, "markdown");
            queueSave();
          }
          break;
        case "convert-code":
          if (focused) {
            setCellType(key, focused, "code");
            queueSave();
          }
          break;
        case "undo-structural":
          undo(key);
          queueSave();
          break;
        case "redo-structural":
          redo(key);
          queueSave();
          break;
        case "merge-below":
          if (focused) {
            mergeWithBelow(key, focused);
            queueSave();
          }
          break;
        case "split-at-cursor":
          if (focused) {
            splitCellAt(key, focused, readNotebookCellCaretOffset() ?? 0);
            queueSave();
          }
          break;
        case "save":
          saveCoordinator.flush();
          break;
        case "focus-prev":
        case "focus-next": {
          const cells = session?.cells ?? [];
          const index = cells.findIndex((cell) => cell.sessionId === focused);
          const nextIndex =
            action.type === "focus-prev"
              ? Math.max(0, index - 1)
              : Math.min(cells.length - 1, index < 0 ? 0 : index + 1);
          const next = cells[nextIndex];
          if (next) focus(key, next.sessionId, "command");
          break;
        }
        case "move-cell-up":
          if (focused) {
            moveCell(key, focused, "up");
            queueSave();
          }
          break;
        case "move-cell-down":
          if (focused) {
            moveCell(key, focused, "down");
            queueSave();
          }
          break;
        case "run-focus-next": {
          setMode(key, "command");
          const cells = session?.cells ?? [];
          const index = cells.findIndex((cell) => cell.sessionId === focused);
          const next = cells[index + 1];
          if (next) focus(key, next.sessionId, "edit");
          break;
        }
      }
    },
    [
      deleteCell,
      focus,
      insertCell,
      key,
      mergeWithBelow,
      moveCell,
      props.readOnly,
      queueSave,
      redo,
      saveCoordinator,
      session?.cells,
      session?.focusedSessionId,
      setCellType,
      setMode,
      splitCellAt,
      undo,
    ],
  );

  useEffect(() => {
    const node = surfaceRef.current;
    if (node === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d" && session?.mode === "command") {
        if (!pendingDeleteRef.current) {
          pendingDeleteRef.current = true;
          if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current);
          pendingDeleteTimerRef.current = setTimeout(() => {
            pendingDeleteRef.current = false;
          }, 500);
          return;
        }
      }
      const action = resolveNotebookKeymap({
        mode: session?.mode ?? "command",
        event: {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
        pendingDelete: pendingDeleteRef.current,
        ignore: isNotebookKeyIgnoredTarget(event.target),
      });
      if (event.key.toLowerCase() === "d") {
        pendingDeleteRef.current = false;
      }
      if (action === null) return;
      event.preventDefault();
      event.stopPropagation();
      runAction(action);
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [runAction, session?.mode]);

  const sourceFile = useProjectFileQuery(
    props.environmentId,
    props.cwd,
    props.relativePath,
    showSource,
  );
  const outline = useNotebookOutline(session?.cells ?? []);
  const persistColabMetadata = notebookUsesColabMetadata(session?.cells ?? []);
  const hiddenSessionIds = useMemo(
    () =>
      notebookCollapsedSessionIds({
        cells: session?.cells ?? [],
        localCollapsed,
        persistColabMetadata,
      }),
    [localCollapsed, persistColabMetadata, session?.cells],
  );

  const toggleSectionCollapse = useCallback(
    (sessionId: string) => {
      const cell = session?.cells.find((entry) => entry.sessionId === sessionId);
      if (cell === undefined || notebookHeadingLevel(cell.source) === null) return;
      const collapsed = notebookSectionIsCollapsed({
        sessionId,
        metadata: cell.metadata,
        localCollapsed,
        persistColabMetadata,
      });
      const nextCollapsed = !collapsed;
      if (persistColabMetadata) {
        setCellMetadata(
          key,
          sessionId,
          notebookMetadataWithSectionCollapsed(cell.metadata, nextCollapsed),
        );
        queueSave();
        return;
      }
      setLocalCollapsed((current) => {
        const next = new Set(current);
        if (nextCollapsed) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    },
    [key, localCollapsed, persistColabMetadata, queueSave, session?.cells, setCellMetadata],
  );

  if (session === undefined) return null;

  const imageBaseDir = notebookImageBaseDir(props.cwd, props.relativePath);
  const saveStatus = notebookSaveStatus({
    editable: !props.readOnly,
    dirty: session.dirty,
    pending,
    diskChanged: session.diskChangedNotice !== null,
  });

  if (showSource) {
    const text = sourceFile.data?.contents ?? "";
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <NotebookToolbar
          readOnly={props.readOnly}
          cellCount={session.cells.length}
          saveStatus={saveStatus}
          onAddCode={() => undefined}
          onAddText={() => undefined}
          onClearAllOutputs={() => undefined}
          showSource={showSource}
          onToggleSource={() => setShowSource(false)}
        />
        {sourceFile.data ? (
          <SourceFilePreview
            name={props.relativePath}
            text={text}
            cacheKey={projectFileCacheKey(props.cwd, props.relativePath, text)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {sourceFile.error ?? "Loading notebook source…"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={surfaceRef} className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={0}>
      <NotebookToolbar
        readOnly={props.readOnly}
        cellCount={session.cells.length}
        saveStatus={saveStatus}
        onAddCode={() => {
          insertCell(key, {
            relativeToSessionId: session.focusedSessionId,
            position: "after",
            cellType: "code",
          });
          queueSave();
        }}
        onAddText={() => {
          insertCell(key, {
            relativeToSessionId: session.focusedSessionId,
            position: "after",
            cellType: "markdown",
          });
          queueSave();
        }}
        onClearAllOutputs={() => {
          clearOutputs(key, "all");
          queueSave();
        }}
        onReload={() => {
          if (session.diskChangedNotice) reloadFromDisk(key, session.diskChangedNotice);
        }}
        onKeepMine={() => {
          keepMine(key);
          queueSave();
        }}
        showSource={showSource}
        onToggleSource={() => setShowSource(true)}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen(!outlineOpen)}
      />
      {props.document.warnings.map((warning) => (
        <FileSurfaceNotice key={warning}>{warning}</FileSurfaceNotice>
      ))}
      <div className="flex min-h-0 flex-1">
        {outlineOpen ? (
          <nav className="w-48 shrink-0 overflow-auto border-r border-border/60 px-2 py-3 text-[12px]">
            {outline.length === 0 ? (
              <p className="px-1 text-muted-foreground">No headings</p>
            ) : (
              <ul className="space-y-1">
                {outline.map((heading) => (
                  <li key={heading.sessionId} style={{ paddingLeft: (heading.level - 1) * 8 }}>
                    <button
                      type="button"
                      className="text-left text-foreground hover:underline"
                      onClick={() => {
                        focus(key, heading.sessionId, "command");
                        document
                          .querySelector(`[data-notebook-session="${heading.sessionId}"]`)
                          ?.scrollIntoView({ block: "start" });
                      }}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        ) : null}
        <ol className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 overflow-auto px-4 py-5">
          {session.cells.map((cell) =>
            hiddenSessionIds.has(cell.sessionId) ? null : (
              <NotebookCellView
                key={cell.sessionId}
                cell={cell}
                storeKey={key}
                relativePath={props.relativePath}
                documentLanguage={session.baseDocument.language}
                readOnly={props.readOnly}
                focused={session.focusedSessionId === cell.sessionId}
                editing={session.focusedSessionId === cell.sessionId && session.mode === "edit"}
                sectionCollapsed={notebookSectionIsCollapsed({
                  sessionId: cell.sessionId,
                  metadata: cell.metadata,
                  localCollapsed,
                  persistColabMetadata,
                })}
                cwd={props.cwd}
                imageBaseDir={imageBaseDir}
                {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
                environmentId={props.environmentId}
                onFocus={() => focus(key, cell.sessionId, session.mode)}
                onRequestEdit={() => focus(key, cell.sessionId, "edit")}
                onSourceChange={(source) => applySource(cell.sessionId, source)}
                {...(props.readOnly
                  ? {}
                  : { onToggleSectionCollapse: () => toggleSectionCollapse(cell.sessionId) })}
                onMove={(direction) => {
                  moveCell(key, cell.sessionId, direction);
                  queueSave();
                }}
                onConvert={() => {
                  if (cell.cellType === "code") setCellType(key, cell.sessionId, "markdown");
                  else if (cell.cellType === "markdown") setCellType(key, cell.sessionId, "code");
                  queueSave();
                }}
                onClearOutputs={() => {
                  clearOutputs(key, cell.sessionId);
                  queueSave();
                }}
                onDelete={() => {
                  deleteCell(key, cell.sessionId);
                  queueSave();
                }}
              />
            ),
          )}
        </ol>
      </div>
    </div>
  );
}
