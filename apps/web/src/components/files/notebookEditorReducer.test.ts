import { describe, expect, it } from "vite-plus/test";
import type { NotebookDocument } from "@t3tools/contracts";

import {
  createNotebookEditorState,
  notebookEditorClearOutputs,
  notebookEditorConfirmSave,
  notebookEditorDeleteCell,
  notebookEditorInsertCell,
  notebookEditorMergeWithBelow,
  notebookEditorMoveCell,
  notebookEditorSetCellMetadata,
  notebookEditorSetCellType,
  notebookEditorSetDiskChanged,
  notebookEditorSetSource,
  notebookEditorSplitCellAt,
  notebookEditorToCellEdits,
  notebookEditorUndo,
} from "./notebookEditorReducer";

function documentFixture(): NotebookDocument {
  return {
    documentId: "doc",
    revision: "rev-1",
    relativePath: "demo.ipynb",
    byteLength: 100,
    nbformat: 4,
    nbformatMinor: 5,
    language: "python",
    cells: [
      {
        sessionId: "md-1",
        persistentId: "md-1",
        cellType: "markdown",
        source: "# Title",
        sourceRevision: "s1",
        executionCount: null,
        outputs: [],
        hasAttachments: false,
        attachments: [],
        metadata: {},
      },
      {
        sessionId: "code-1",
        persistentId: "code-1",
        cellType: "code",
        language: "python",
        source: "print(1)",
        sourceRevision: "s2",
        executionCount: 1,
        outputs: [{ outputType: "stream", name: "stdout", text: "1\n" }],
        hasAttachments: false,
        attachments: [],
        metadata: {},
      },
    ],
    metadata: {},
    warnings: [],
    readOnly: false,
    capabilities: {
      colabExecution: false,
      editing: true,
      interactiveWidgets: false,
      interactivePlotly: false,
    },
  };
}

describe("notebookEditorReducer", () => {
  it("inserts, moves, and deletes cells with structural undo", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorInsertCell(state, {
      relativeToSessionId: "md-1",
      position: "after",
      cellType: "code",
    });
    expect(state.cells).toHaveLength(3);
    expect(state.cells[1]?.cellType).toBe("code");
    const insertedId = state.cells[1]?.sessionId ?? "";

    state = notebookEditorMoveCell(state, insertedId, "down");
    expect(state.cells.map((cell) => cell.sessionId)).toEqual(["md-1", "code-1", insertedId]);

    state = notebookEditorDeleteCell(state, insertedId);
    expect(state.cells.map((cell) => cell.sessionId)).toEqual(["md-1", "code-1"]);

    state = notebookEditorUndo(state);
    expect(state.cells).toHaveLength(3);
  });

  it("setSource marks dirty without pushing structural history", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetSource(state, "code-1", "print(2)");
    expect(state.dirty).toBe(true);
    expect(state.historyPast).toHaveLength(0);
    expect(state.cells[1]?.source).toBe("print(2)");
  });

  it("converts code to markdown and clears outputs on save payload", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetCellType(state, "code-1", "markdown");
    expect(state.cells[1]?.cellType).toBe("markdown");
    expect(state.cells[1]?.outputs).toEqual([]);
    const edits = notebookEditorToCellEdits(state);
    expect(edits[1]).toMatchObject({ cellType: "markdown", outputs: "clear" });
  });

  it("clears one or all outputs", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorClearOutputs(state, "code-1");
    expect(state.cells[1]?.outputs).toEqual([]);
    expect(notebookEditorToCellEdits(state)[1]?.outputs).toBe("clear");
  });

  it("splits and merges cells", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetSource(state, "code-1", "a\nb");
    state = notebookEditorSplitCellAt(state, "code-1", 2);
    expect(state.cells[1]?.source).toBe("a\n");
    expect(state.cells[2]?.source).toBe("b");
    state = notebookEditorMergeWithBelow(state, "code-1");
    expect(state.cells[1]?.source).toBe("a\nb");
    expect(state.cells).toHaveLength(2);
  });

  it("rebases local edits after confirm when saveEpoch advanced", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetSource(state, "code-1", "print(2)");
    const savedEpoch = state.saveEpoch;
    state = notebookEditorSetSource(state, "code-1", "print(3)");
    const savedDocument: NotebookDocument = {
      ...documentFixture(),
      revision: "rev-2",
      cells: documentFixture().cells.map((cell) =>
        cell.sessionId === "code-1" ? { ...cell, source: "print(2)" } : cell,
      ),
    };
    state = notebookEditorConfirmSave(state, savedDocument, savedEpoch);
    expect(state.baseDocument.revision).toBe("rev-2");
    expect(state.dirty).toBe(true);
    expect(state.cells[1]?.source).toBe("print(3)");
  });

  it("clears dirty when confirm catches up", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetSource(state, "code-1", "print(2)");
    const savedEpoch = state.saveEpoch;
    const savedDocument: NotebookDocument = {
      ...documentFixture(),
      revision: "rev-2",
      cells: documentFixture().cells.map((cell) =>
        cell.sessionId === "code-1" ? { ...cell, source: "print(2)" } : cell,
      ),
    };
    state = notebookEditorConfirmSave(state, savedDocument, savedEpoch);
    expect(state.dirty).toBe(false);
    expect(state.cells[1]?.source).toBe("print(2)");
  });

  it("records disk changed notices", () => {
    let state = createNotebookEditorState(documentFixture());
    const notice = { ...documentFixture(), revision: "rev-disk" };
    state = notebookEditorSetDiskChanged(state, notice);
    expect(state.diskChangedNotice?.revision).toBe("rev-disk");
  });

  it("setCellMetadata marks dirty and is included in save edits", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetCellMetadata(state, "md-1", {
      colab: { collapsed: true },
    });
    expect(state.dirty).toBe(true);
    expect(state.cells[0]?.metadata).toEqual({ colab: { collapsed: true } });
    expect(notebookEditorToCellEdits(state)[0]?.metadata).toEqual({
      colab: { collapsed: true },
    });
  });

  it("splitCellAt uses the caret offset", () => {
    let state = createNotebookEditorState(documentFixture());
    state = notebookEditorSetSource(state, "code-1", "abcdef");
    state = notebookEditorSplitCellAt(state, "code-1", 3);
    expect(state.cells[1]?.source).toBe("abc");
    expect(state.cells[2]?.source).toBe("def");
  });
});
