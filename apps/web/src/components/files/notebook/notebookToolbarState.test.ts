import { describe, expect, it } from "vite-plus/test";

import {
  notebookCellCountLabel,
  notebookSaveStatus,
  type NotebookSaveStatusInput,
} from "./notebookToolbarState";

function input(overrides: Partial<NotebookSaveStatusInput> = {}): NotebookSaveStatusInput {
  return { editable: true, dirty: false, pending: false, diskChanged: false, ...overrides };
}

describe("notebookSaveStatus", () => {
  it("reports read-only before anything else", () => {
    expect(notebookSaveStatus(input({ editable: false, dirty: true, diskChanged: true }))).toBe(
      "read-only",
    );
  });

  it("reports a disk change ahead of the local draft state", () => {
    expect(notebookSaveStatus(input({ dirty: true, pending: true, diskChanged: true }))).toBe(
      "disk-changed",
    );
  });

  it("separates a write that is owed from one that is not", () => {
    expect(notebookSaveStatus(input({ dirty: true, pending: true }))).toBe("saving");
    expect(notebookSaveStatus(input({ dirty: true, pending: false }))).toBe("unsaved");
    expect(notebookSaveStatus(input())).toBe("saved");
  });
});

describe("notebookCellCountLabel", () => {
  it("pluralizes", () => {
    expect(notebookCellCountLabel(1)).toBe("1 cell");
    expect(notebookCellCountLabel(0)).toBe("0 cells");
    expect(notebookCellCountLabel(12)).toBe("12 cells");
  });
});
