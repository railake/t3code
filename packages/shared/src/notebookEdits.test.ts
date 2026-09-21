import { describe, expect, it } from "vite-plus/test";
import type { NotebookCellEdit } from "@t3tools/contracts";

import { applyNotebookEdits, notebookCellSessionId, notebookSourceLines } from "./notebookEdits.ts";
import { notebookDocumentFromBytes, notebookSourceText } from "./notebook.ts";

const encoder = new TextEncoder();

function editsFromRaw(rawText: string): NotebookCellEdit[] {
  const parsed = JSON.parse(rawText) as {
    cells: Array<Record<string, unknown>>;
  };
  return parsed.cells.map((cell, index) => {
    const cellType =
      cell.cell_type === "code" || cell.cell_type === "markdown" || cell.cell_type === "raw"
        ? cell.cell_type
        : "unknown";
    return {
      sessionId: notebookCellSessionId(cell, index),
      persistentId: typeof cell.id === "string" && cell.id.trim().length > 0 ? cell.id : null,
      cellType,
      source: notebookSourceText(cell.source),
      metadata:
        cell.metadata !== null && typeof cell.metadata === "object" && !Array.isArray(cell.metadata)
          ? (cell.metadata as Record<string, unknown>)
          : {},
      outputs: "keep" as const,
    };
  });
}

function fixture(indent: number, minor = 5) {
  const notebook = {
    nbformat: 4,
    nbformat_minor: minor,
    metadata: {
      colab: { provenance: [] },
      widgets: { "application/vnd.jupyter.widget-state+json": { state: { keep: true } } },
      customKeep: { nested: true },
    },
    cells: [
      {
        id: "md-1",
        cell_type: "markdown",
        source: ["# Title\n"],
        metadata: { colab: { collapsed: false } },
      },
      {
        id: "code-1",
        cell_type: "code",
        execution_count: 2,
        source: ["print(1)\n"],
        metadata: {},
        outputs: [{ output_type: "stream", name: "stdout", text: ["1\n"] }],
        mystery: true,
      },
    ],
  };
  return `${JSON.stringify(notebook, null, indent)}\n`;
}

describe("notebookSourceLines", () => {
  it("stores trailing newlines on every line except the last", () => {
    expect(notebookSourceLines("a\nb\nc")).toEqual(["a\n", "b\n", "c"]);
    expect(notebookSourceLines("a\n")).toEqual(["a\n"]);
    expect(notebookSourceLines("plain")).toEqual(["plain"]);
    expect(notebookSourceLines("")).toEqual([]);
  });
});

describe("applyNotebookEdits", () => {
  it("round-trips identity when edits equal the original cells", () => {
    const raw = fixture(1);
    const result = applyNotebookEdits(raw, editsFromRaw(raw));
    expect(result.text).toBe(raw);
    expect(JSON.parse(result.text).metadata.widgets).toEqual({
      "application/vnd.jupyter.widget-state+json": { state: { keep: true } },
    });
  });

  it("preserves unknown cell keys and widget state across an edit", () => {
    const raw = fixture(1);
    const edits = editsFromRaw(raw);
    edits[1] = {
      ...edits[1]!,
      source: "print(2)\n",
    };
    const result = applyNotebookEdits(raw, edits);
    const parsed = JSON.parse(result.text) as {
      metadata: { widgets: unknown; customKeep: unknown };
      cells: Array<Record<string, unknown>>;
    };
    expect(parsed.metadata.widgets).toEqual({
      "application/vnd.jupyter.widget-state+json": { state: { keep: true } },
    });
    expect(parsed.metadata.customKeep).toEqual({ nested: true });
    expect(parsed.cells[1]?.mystery).toBe(true);
    expect(notebookSourceText(parsed.cells[1]?.source)).toBe("print(2)\n");
  });

  it("preserves 1-space and 2-space indent plus trailing newline", () => {
    for (const indent of [1, 2]) {
      const raw = fixture(indent);
      const edits = editsFromRaw(raw);
      edits[0] = { ...edits[0]!, source: "# Edited\n" };
      const result = applyNotebookEdits(raw, edits);
      expect(result.text.endsWith("\n")).toBe(true);
      expect(result.text).toContain(`\n${" ".repeat(indent)}"nbformat"`);
      expect(detectLeadingIndent(result.text)).toBe(indent);
    }
  });

  it("adds a cell id only when nbformat_minor >= 5", () => {
    const withIds = applyNotebookEdits(fixture(1, 5), [
      ...editsFromRaw(fixture(1, 5)),
      {
        sessionId: "new-1",
        persistentId: null,
        cellType: "code",
        source: "x = 1",
        metadata: {},
        outputs: "keep",
      },
    ]);
    const withoutIds = applyNotebookEdits(fixture(1, 4), [
      ...editsFromRaw(fixture(1, 4)),
      {
        sessionId: "new-1",
        persistentId: null,
        cellType: "markdown",
        source: "hi",
        metadata: {},
        outputs: "keep",
      },
    ]);
    const newWithId = JSON.parse(withIds.text).cells.at(-1) as Record<string, unknown>;
    const newWithoutId = JSON.parse(withoutIds.text).cells.at(-1) as Record<string, unknown>;
    expect(typeof newWithId.id).toBe("string");
    expect(String(newWithId.id)).toMatch(/^[0-9a-f]{8}$/);
    expect(newWithoutId.id).toBeUndefined();
  });

  it("converts code to markdown by dropping outputs and execution_count", () => {
    const raw = fixture(1);
    const edits = editsFromRaw(raw);
    edits[1] = {
      ...edits[1]!,
      cellType: "markdown",
      source: "was code",
      outputs: "keep",
    };
    const cell = JSON.parse(applyNotebookEdits(raw, edits).text).cells[1] as Record<
      string,
      unknown
    >;
    expect(cell.cell_type).toBe("markdown");
    expect(cell.outputs).toBeUndefined();
    expect(cell.execution_count).toBeUndefined();
    expect(notebookSourceText(cell.source)).toBe("was code");
    expect(cell.mystery).toBe(true);
  });

  it("respects delete and move order from the edits array", () => {
    const raw = fixture(1);
    const [md, code] = editsFromRaw(raw);
    const result = applyNotebookEdits(raw, [code!, md!]);
    const cells = JSON.parse(result.text).cells as Array<Record<string, unknown>>;
    expect(cells.map((cell) => cell.id)).toEqual(["code-1", "md-1"]);

    const deleted = applyNotebookEdits(raw, [md!]);
    expect(JSON.parse(deleted.text).cells.map((cell: { id: string }) => cell.id)).toEqual(["md-1"]);
  });

  it("clears outputs when requested and keeps them when marked keep", () => {
    const raw = fixture(1);
    const edits = editsFromRaw(raw);
    edits[1] = { ...edits[1]!, outputs: "clear" };
    const cleared = JSON.parse(applyNotebookEdits(raw, edits).text).cells[1] as Record<
      string,
      unknown
    >;
    expect(cleared.outputs).toEqual([]);
    expect(cleared.execution_count).toBeNull();

    const kept = JSON.parse(applyNotebookEdits(raw, editsFromRaw(raw)).text).cells[1] as Record<
      string,
      unknown
    >;
    expect(kept.outputs).toEqual([{ output_type: "stream", name: "stdout", text: ["1\n"] }]);
    expect(kept.execution_count).toBe(2);
  });

  it("leaves parser editing flags aligned with nbformat 4", () => {
    const editable = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "a.ipynb",
      bytes: encoder.encode(fixture(1)),
    });
    expect(editable._tag).toBe("Success");
    if (editable._tag !== "Success") return;
    expect(editable.document.readOnly).toBe(false);
    expect(editable.document.capabilities.editing).toBe(true);
  });
});

function detectLeadingIndent(text: string): number {
  const match = /\n( +)"/.exec(text);
  return match?.[1]?.length ?? 0;
}
