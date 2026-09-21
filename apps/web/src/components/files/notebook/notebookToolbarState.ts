export type NotebookSaveStatus = "read-only" | "disk-changed" | "saving" | "unsaved" | "saved";

export interface NotebookSaveStatusInput {
  readonly editable: boolean;
  /** The draft differs from the document last confirmed by the server. */
  readonly dirty: boolean;
  /** The save coordinator holds a write, either debounced or in flight. */
  readonly pending: boolean;
  readonly diskChanged: boolean;
}

/**
 * "Saving" covers the autosave debounce as well as the write itself: from the
 * user's side the change is on its way to disk either way. "Unsaved" is the
 * narrow window where the draft changed but no write is owed yet, and the
 * resting state after a write failed.
 */
export function notebookSaveStatus(input: NotebookSaveStatusInput): NotebookSaveStatus {
  if (!input.editable) return "read-only";
  if (input.diskChanged) return "disk-changed";
  if (!input.dirty) return "saved";
  return input.pending ? "saving" : "unsaved";
}

export function notebookSaveStatusLabel(status: NotebookSaveStatus): string {
  switch (status) {
    case "read-only":
      return "Read only";
    case "disk-changed":
      return "Changed on disk";
    case "saving":
      return "Saving…";
    case "unsaved":
      return "Unsaved";
    case "saved":
      return "Saved";
  }
}

export function notebookCellCountLabel(count: number): string {
  return `${count} ${count === 1 ? "cell" : "cells"}`;
}
