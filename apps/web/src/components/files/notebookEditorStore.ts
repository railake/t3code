import type { EnvironmentId, NotebookDocument } from "@t3tools/contracts";
import { create } from "zustand";

import {
  createNotebookEditorState,
  notebookEditorClearOutputs,
  notebookEditorConfirmSave,
  notebookEditorDeleteCell,
  notebookEditorFocus,
  notebookEditorInsertCell,
  notebookEditorKeepMine,
  notebookEditorMergeWithBelow,
  notebookEditorMoveCell,
  notebookEditorRedo,
  notebookEditorReloadFromDisk,
  notebookEditorSetCellType,
  notebookEditorSetDiskChanged,
  notebookEditorSetCellMetadata,
  notebookEditorSetMode,
  notebookEditorSetSource,
  notebookEditorSplitCellAt,
  notebookEditorToCellEdits,
  notebookEditorUndo,
  type NotebookDraftCell,
  type NotebookEditorMode,
  type NotebookEditorState,
} from "./notebookEditorReducer";

export function notebookEditorStoreKey(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
): string {
  return `${environmentId}:${cwd}:${relativePath}`;
}

type NotebookEditorStoreState = {
  readonly sessions: Readonly<Record<string, NotebookEditorState>>;
  ensure: (key: string, document: NotebookDocument) => void;
  replaceIfClean: (key: string, document: NotebookDocument) => void;
  get: (key: string) => NotebookEditorState | undefined;
  insertCell: (
    key: string,
    input: {
      readonly relativeToSessionId: string | null;
      readonly position: "before" | "after";
      readonly cellType: "code" | "markdown" | "raw";
    },
  ) => void;
  deleteCell: (key: string, sessionId: string) => void;
  moveCell: (key: string, sessionId: string, direction: "up" | "down") => void;
  setSource: (key: string, sessionId: string, source: string) => void;
  setCellMetadata: (
    key: string,
    sessionId: string,
    metadata: Readonly<Record<string, unknown>>,
  ) => void;
  setCellType: (key: string, sessionId: string, cellType: "code" | "markdown" | "raw") => void;
  clearOutputs: (key: string, sessionId: string | "all") => void;
  splitCellAt: (key: string, sessionId: string, cursorOffset: number) => void;
  mergeWithBelow: (key: string, sessionId: string) => void;
  undo: (key: string) => void;
  redo: (key: string) => void;
  focus: (key: string, sessionId: string | null, mode?: NotebookEditorMode) => void;
  setMode: (key: string, mode: NotebookEditorMode) => void;
  confirmSave: (key: string, document: NotebookDocument, savedEpoch: number) => void;
  setDiskChanged: (key: string, document: NotebookDocument) => void;
  reloadFromDisk: (key: string, document: NotebookDocument) => void;
  keepMine: (key: string) => void;
  drop: (key: string) => void;
};

function updateSession(
  sessions: Readonly<Record<string, NotebookEditorState>>,
  key: string,
  update: (state: NotebookEditorState) => NotebookEditorState,
): Readonly<Record<string, NotebookEditorState>> {
  const current = sessions[key];
  if (current === undefined) return sessions;
  const next = update(current);
  if (next === current) return sessions;
  return { ...sessions, [key]: next };
}

export const useNotebookEditorStore = create<NotebookEditorStoreState>((set, get) => ({
  sessions: {},

  ensure: (key, document) => {
    if (get().sessions[key] !== undefined) return;
    set((state) => ({
      sessions: { ...state.sessions, [key]: createNotebookEditorState(document) },
    }));
  },

  replaceIfClean: (key, document) => {
    const current = get().sessions[key];
    if (current !== undefined && current.dirty) return;
    if (current !== undefined && current.baseDocument.revision === document.revision) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [key]: createNotebookEditorState(document),
      },
    }));
  },

  get: (key) => get().sessions[key],

  insertCell: (key, input) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorInsertCell(session, input),
      ),
    })),

  deleteCell: (key, sessionId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorDeleteCell(session, sessionId),
      ),
    })),

  moveCell: (key, sessionId, direction) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorMoveCell(session, sessionId, direction),
      ),
    })),

  setSource: (key, sessionId, source) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSetSource(session, sessionId, source),
      ),
    })),

  setCellMetadata: (key, sessionId, metadata) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSetCellMetadata(session, sessionId, metadata),
      ),
    })),

  setCellType: (key, sessionId, cellType) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSetCellType(session, sessionId, cellType),
      ),
    })),

  clearOutputs: (key, sessionId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorClearOutputs(session, sessionId),
      ),
    })),

  splitCellAt: (key, sessionId, cursorOffset) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSplitCellAt(session, sessionId, cursorOffset),
      ),
    })),

  mergeWithBelow: (key, sessionId) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorMergeWithBelow(session, sessionId),
      ),
    })),

  undo: (key) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, notebookEditorUndo),
    })),

  redo: (key) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, notebookEditorRedo),
    })),

  focus: (key, sessionId, mode) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorFocus(session, sessionId, mode),
      ),
    })),

  setMode: (key, mode) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSetMode(session, mode),
      ),
    })),

  confirmSave: (key, document, savedEpoch) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorConfirmSave(session, document, savedEpoch),
      ),
    })),

  setDiskChanged: (key, document) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorSetDiskChanged(session, document),
      ),
    })),

  reloadFromDisk: (key, document) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, (session) =>
        notebookEditorReloadFromDisk(session, document),
      ),
    })),

  keepMine: (key) =>
    set((state) => ({
      sessions: updateSession(state.sessions, key, notebookEditorKeepMine),
    })),

  drop: (key) =>
    set((state) => {
      if (state.sessions[key] === undefined) return state;
      const { [key]: _removed, ...sessions } = state.sessions;
      return { sessions };
    }),
}));

export function selectNotebookEditorSession(key: string) {
  return (state: NotebookEditorStoreState): NotebookEditorState | undefined => state.sessions[key];
}

export function selectNotebookDraftCells(key: string) {
  return (state: NotebookEditorStoreState): ReadonlyArray<NotebookDraftCell> | undefined =>
    state.sessions[key]?.cells;
}

export { notebookEditorToCellEdits };
