import type {
  NotebookCell,
  NotebookCellEdit,
  NotebookCellType,
  NotebookDocument,
} from "@t3tools/contracts";

export type NotebookEditorMode = "command" | "edit";

export type NotebookDraftCell = NotebookCell & {
  /** When true, the next save sends `outputs: "clear"` for this cell. */
  readonly clearOutputsOnSave: boolean;
};

export type NotebookEditorState = {
  readonly baseDocument: NotebookDocument;
  readonly cells: ReadonlyArray<NotebookDraftCell>;
  readonly focusedSessionId: string | null;
  readonly mode: NotebookEditorMode;
  readonly dirty: boolean;
  readonly historyPast: ReadonlyArray<ReadonlyArray<NotebookDraftCell>>;
  readonly historyFuture: ReadonlyArray<ReadonlyArray<NotebookDraftCell>>;
  readonly diskChangedNotice: NotebookDocument | null;
  /** Revision of the draft last handed to the save coordinator. */
  readonly saveEpoch: number;
};

const HISTORY_CAP = 100;

function cloneCells(cells: ReadonlyArray<NotebookDraftCell>): NotebookDraftCell[] {
  return cells.map((cell) => ({
    ...cell,
    outputs: cell.outputs.map((output) =>
      output.outputType === "display"
        ? { ...output, payloads: [...output.payloads] }
        : output.outputType === "error"
          ? { ...output, traceback: [...output.traceback] }
          : { ...output },
    ),
    attachments: cell.attachments.map((attachment) => ({ ...attachment })),
    metadata: { ...cell.metadata },
  }));
}

export function draftCellsFromDocument(
  document: NotebookDocument,
): ReadonlyArray<NotebookDraftCell> {
  return document.cells.map((cell) => ({
    ...cell,
    metadata: { ...cell.metadata },
    attachments: [...cell.attachments],
    outputs: [...cell.outputs],
    clearOutputsOnSave: false,
  }));
}

export function createNotebookEditorState(document: NotebookDocument): NotebookEditorState {
  const cells = draftCellsFromDocument(document);
  return {
    baseDocument: document,
    cells,
    focusedSessionId: cells[0]?.sessionId ?? null,
    mode: "command",
    dirty: false,
    historyPast: [],
    historyFuture: [],
    diskChangedNotice: null,
    saveEpoch: 0,
  };
}

function withStructuralHistory(
  state: NotebookEditorState,
  nextCells: ReadonlyArray<NotebookDraftCell>,
): NotebookEditorState {
  const historyPast = [...state.historyPast, cloneCells(state.cells)].slice(-HISTORY_CAP);
  return {
    ...state,
    cells: nextCells,
    dirty: true,
    historyPast,
    historyFuture: [],
    saveEpoch: state.saveEpoch + 1,
  };
}

function findIndex(cells: ReadonlyArray<NotebookDraftCell>, sessionId: string): number {
  return cells.findIndex((cell) => cell.sessionId === sessionId);
}

function newSessionId(cells: ReadonlyArray<NotebookDraftCell>): string {
  let index = cells.length;
  let candidate = `cell:new:${index}`;
  const used = new Set(cells.map((cell) => cell.sessionId));
  while (used.has(candidate)) {
    index += 1;
    candidate = `cell:new:${index}`;
  }
  return candidate;
}

function emptyCell(
  cellType: Exclude<NotebookCellType, "unknown">,
  sessionId: string,
  language: string | undefined,
): NotebookDraftCell {
  return {
    sessionId,
    persistentId: null,
    cellType,
    ...(language === undefined || cellType !== "code" ? {} : { language }),
    source: "",
    sourceRevision: "",
    executionCount: cellType === "code" ? null : null,
    outputs: [],
    hasAttachments: false,
    attachments: [],
    metadata: {},
    clearOutputsOnSave: cellType === "code",
  };
}

export function notebookEditorInsertCell(
  state: NotebookEditorState,
  input: {
    readonly relativeToSessionId: string | null;
    readonly position: "before" | "after";
    readonly cellType: Exclude<NotebookCellType, "unknown">;
  },
): NotebookEditorState {
  const cells = [...state.cells];
  const sessionId = newSessionId(cells);
  const cell = emptyCell(input.cellType, sessionId, state.baseDocument.language);
  const anchor =
    input.relativeToSessionId === null ? -1 : findIndex(cells, input.relativeToSessionId);
  const insertAt =
    anchor < 0
      ? input.position === "before"
        ? 0
        : cells.length
      : input.position === "before"
        ? anchor
        : anchor + 1;
  cells.splice(insertAt, 0, cell);
  return {
    ...withStructuralHistory(state, cells),
    focusedSessionId: sessionId,
    mode: "edit",
  };
}

export function notebookEditorDeleteCell(
  state: NotebookEditorState,
  sessionId: string,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const cells = state.cells.filter((cell) => cell.sessionId !== sessionId);
  const focusedSessionId = cells[Math.min(index, cells.length - 1)]?.sessionId ?? null;
  return {
    ...withStructuralHistory(state, cells),
    focusedSessionId,
    mode: "command",
  };
}

export function notebookEditorMoveCell(
  state: NotebookEditorState,
  sessionId: string,
  direction: "up" | "down",
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.cells.length) return state;
  const cells = [...state.cells];
  const [removed] = cells.splice(index, 1);
  if (removed === undefined) return state;
  cells.splice(target, 0, removed);
  return withStructuralHistory(state, cells);
}

export function notebookEditorSetSource(
  state: NotebookEditorState,
  sessionId: string,
  source: string,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const cell = state.cells[index];
  if (cell === undefined || cell.source === source) return state;
  const cells = [...state.cells];
  cells[index] = { ...cell, source, sourceRevision: "" };
  return {
    ...state,
    cells,
    dirty: true,
    saveEpoch: state.saveEpoch + 1,
  };
}

/** Updates cell metadata (e.g. Colab section collapse) without structural history. */
export function notebookEditorSetCellMetadata(
  state: NotebookEditorState,
  sessionId: string,
  metadata: Readonly<Record<string, unknown>>,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const cell = state.cells[index];
  if (cell === undefined) return state;
  const cells = [...state.cells];
  cells[index] = { ...cell, metadata: { ...metadata } };
  return {
    ...state,
    cells,
    dirty: true,
    saveEpoch: state.saveEpoch + 1,
  };
}

export function notebookEditorSetCellType(
  state: NotebookEditorState,
  sessionId: string,
  cellType: Exclude<NotebookCellType, "unknown">,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const cell = state.cells[index];
  if (cell === undefined || cell.cellType === cellType) return state;
  const cells = [...state.cells];
  const clearOutputs = cell.cellType === "code" && cellType !== "code";
  cells[index] = {
    ...cell,
    cellType,
    ...(clearOutputs
      ? { outputs: [], executionCount: null, clearOutputsOnSave: true }
      : cellType === "code"
        ? { outputs: [], executionCount: null, clearOutputsOnSave: true }
        : {}),
  };
  return withStructuralHistory(state, cells);
}

export function notebookEditorClearOutputs(
  state: NotebookEditorState,
  sessionId: string | "all",
): NotebookEditorState {
  const cells = state.cells.map((cell) => {
    if (sessionId !== "all" && cell.sessionId !== sessionId) return cell;
    if (cell.cellType !== "code") return cell;
    if (cell.outputs.length === 0 && cell.executionCount === null && cell.clearOutputsOnSave) {
      return cell;
    }
    return {
      ...cell,
      outputs: [],
      executionCount: null,
      clearOutputsOnSave: true,
    };
  });
  const changed = cells.some((cell, index) => cell !== state.cells[index]);
  if (!changed) return state;
  return withStructuralHistory(state, cells);
}

export function notebookEditorSplitCellAt(
  state: NotebookEditorState,
  sessionId: string,
  cursorOffset: number,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0) return state;
  const cell = state.cells[index];
  if (cell === undefined) return state;
  if (cell.cellType === "unknown") return state;
  const offset = Math.max(0, Math.min(cursorOffset, cell.source.length));
  const before = cell.source.slice(0, offset);
  const after = cell.source.slice(offset);
  const newId = newSessionId(state.cells);
  const cells = [...state.cells];
  cells[index] = { ...cell, source: before, sourceRevision: "" };
  cells.splice(index + 1, 0, {
    ...emptyCell(cell.cellType, newId, cell.language),
    source: after,
    metadata: { ...cell.metadata },
  });
  return {
    ...withStructuralHistory(state, cells),
    focusedSessionId: newId,
    mode: "edit",
  };
}

export function notebookEditorMergeWithBelow(
  state: NotebookEditorState,
  sessionId: string,
): NotebookEditorState {
  const index = findIndex(state.cells, sessionId);
  if (index < 0 || index >= state.cells.length - 1) return state;
  const cell = state.cells[index];
  const below = state.cells[index + 1];
  if (cell === undefined || below === undefined) return state;
  if (cell.cellType === "unknown" || below.cellType === "unknown") return state;
  if (cell.cellType !== below.cellType) return state;
  const cells = [...state.cells];
  const mergedSource =
    cell.source.length === 0
      ? below.source
      : below.source.length === 0
        ? cell.source
        : `${cell.source}${cell.source.endsWith("\n") ? "" : "\n"}${below.source}`;
  cells[index] = {
    ...cell,
    source: mergedSource,
    sourceRevision: "",
    outputs: cell.cellType === "code" ? [] : cell.outputs,
    executionCount: cell.cellType === "code" ? null : cell.executionCount,
    clearOutputsOnSave: cell.cellType === "code" ? true : cell.clearOutputsOnSave,
  };
  cells.splice(index + 1, 1);
  return {
    ...withStructuralHistory(state, cells),
    focusedSessionId: cell.sessionId,
  };
}

export function notebookEditorUndo(state: NotebookEditorState): NotebookEditorState {
  const previous = state.historyPast.at(-1);
  if (previous === undefined) return state;
  return {
    ...state,
    cells: previous,
    historyPast: state.historyPast.slice(0, -1),
    historyFuture: [cloneCells(state.cells), ...state.historyFuture].slice(0, HISTORY_CAP),
    dirty: true,
    saveEpoch: state.saveEpoch + 1,
    mode: "command",
  };
}

export function notebookEditorRedo(state: NotebookEditorState): NotebookEditorState {
  const next = state.historyFuture[0];
  if (next === undefined) return state;
  return {
    ...state,
    cells: next,
    historyPast: [...state.historyPast, cloneCells(state.cells)].slice(-HISTORY_CAP),
    historyFuture: state.historyFuture.slice(1),
    dirty: true,
    saveEpoch: state.saveEpoch + 1,
    mode: "command",
  };
}

export function notebookEditorFocus(
  state: NotebookEditorState,
  sessionId: string | null,
  mode: NotebookEditorMode = state.mode,
): NotebookEditorState {
  return { ...state, focusedSessionId: sessionId, mode };
}

export function notebookEditorSetMode(
  state: NotebookEditorState,
  mode: NotebookEditorMode,
): NotebookEditorState {
  return { ...state, mode };
}

export function notebookEditorToCellEdits(
  state: NotebookEditorState,
): ReadonlyArray<NotebookCellEdit> {
  return state.cells.map((cell) => ({
    sessionId: cell.sessionId,
    persistentId: cell.persistentId,
    cellType: cell.cellType,
    source: cell.source,
    metadata: cell.metadata,
    outputs: cell.clearOutputsOnSave ? "clear" : "keep",
  }));
}

/**
 * After a successful save, replace the base document and rebase any local
 * edits that landed while the write was in flight (matched by sessionId).
 */
export function notebookEditorConfirmSave(
  state: NotebookEditorState,
  savedDocument: NotebookDocument,
  savedEpoch: number,
): NotebookEditorState {
  const savedCells = draftCellsFromDocument(savedDocument);
  if (state.saveEpoch === savedEpoch) {
    return {
      ...state,
      baseDocument: savedDocument,
      cells: savedCells,
      dirty: false,
      diskChangedNotice: null,
      historyPast: [],
      historyFuture: [],
    };
  }

  const localById = new Map(state.cells.map((cell) => [cell.sessionId, cell]));
  const rebased = savedCells.map((saved) => {
    const local = localById.get(saved.sessionId);
    if (local === undefined) return saved;
    if (local.source === saved.source && local.cellType === saved.cellType) {
      return {
        ...saved,
        clearOutputsOnSave: local.clearOutputsOnSave && saved.outputs.length > 0,
      };
    }
    return {
      ...saved,
      cellType: local.cellType,
      source: local.source,
      metadata: local.metadata,
      clearOutputsOnSave: local.clearOutputsOnSave,
      outputs: local.clearOutputsOnSave ? [] : local.outputs,
      executionCount: local.clearOutputsOnSave ? null : local.executionCount,
    };
  });
  for (const local of state.cells) {
    if (savedCells.some((cell) => cell.sessionId === local.sessionId)) continue;
    rebased.push(local);
  }

  return {
    ...state,
    baseDocument: savedDocument,
    cells: rebased,
    dirty: true,
    diskChangedNotice: null,
  };
}

export function notebookEditorSetDiskChanged(
  state: NotebookEditorState,
  document: NotebookDocument,
): NotebookEditorState {
  return { ...state, diskChangedNotice: document, dirty: true };
}

export function notebookEditorReloadFromDisk(
  state: NotebookEditorState,
  document: NotebookDocument,
): NotebookEditorState {
  return {
    ...createNotebookEditorState(document),
    focusedSessionId: state.focusedSessionId,
  };
}

export function notebookEditorKeepMine(state: NotebookEditorState): NotebookEditorState {
  if (state.diskChangedNotice === null) return state;
  return {
    ...state,
    baseDocument: {
      ...state.diskChangedNotice,
      // Keep local cells; adopt the disk revision so the next save can conflict
      // cleanly if needed. Prefer the notice revision as the new base only after
      // the user chooses to overwrite — here we keep dirty local cells and bump
      // baseRevision to the notice so save uses the latest disk revision.
      revision: state.diskChangedNotice.revision,
    },
    diskChangedNotice: null,
    dirty: true,
    saveEpoch: state.saveEpoch + 1,
  };
}
