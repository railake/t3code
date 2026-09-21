import { useMemo } from "react";

import type { NotebookDraftCell } from "../notebookEditorReducer";

export const NOTEBOOK_OUTLINE_STORAGE_KEY = "t3.notebook.outlineOpen";

export type NotebookOutlineHeading = {
  readonly sessionId: string;
  readonly level: number;
  readonly text: string;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/m;

export function notebookHeadingLevel(source: string): number | null {
  const match = HEADING_RE.exec(source);
  if (match === null) return null;
  return match[1]?.length ?? 1;
}

export function notebookColabSectionCollapsed(
  metadata: Readonly<Record<string, unknown>>,
): boolean {
  const colab = metadata.colab;
  return (
    colab !== null &&
    typeof colab === "object" &&
    !Array.isArray(colab) &&
    (colab as { collapsed?: unknown }).collapsed === true
  );
}

export function notebookSectionIsCollapsed(input: {
  readonly sessionId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly localCollapsed: ReadonlySet<string>;
  readonly persistColabMetadata: boolean;
}): boolean {
  if (input.localCollapsed.has(input.sessionId)) return true;
  return input.persistColabMetadata && notebookColabSectionCollapsed(input.metadata);
}

/** Writes `metadata.colab.collapsed` while preserving other Colab keys. */
export function notebookMetadataWithSectionCollapsed(
  metadata: Readonly<Record<string, unknown>>,
  collapsed: boolean,
): Record<string, unknown> {
  const colab = metadata.colab;
  const existing =
    colab !== null && typeof colab === "object" && !Array.isArray(colab)
      ? { ...(colab as Record<string, unknown>) }
      : {};
  return { ...metadata, colab: { ...existing, collapsed } };
}

export function notebookOutlineFromCells(
  cells: ReadonlyArray<Pick<NotebookDraftCell, "sessionId" | "cellType" | "source">>,
): ReadonlyArray<NotebookOutlineHeading> {
  const headings: NotebookOutlineHeading[] = [];
  for (const cell of cells) {
    if (cell.cellType !== "markdown") continue;
    const match = HEADING_RE.exec(cell.source);
    if (match === null) continue;
    headings.push({
      sessionId: cell.sessionId,
      level: match[1]?.length ?? 1,
      text: (match[2] ?? "").trim(),
    });
  }
  return headings;
}

/**
 * Colab section collapse: a heading cell with collapsed metadata (or local UI
 * state) hides following cells until the next heading of equal or higher level.
 */
export function notebookCollapsedSessionIds(input: {
  readonly cells: ReadonlyArray<
    Pick<NotebookDraftCell, "sessionId" | "cellType" | "source" | "metadata">
  >;
  readonly localCollapsed: ReadonlySet<string>;
  readonly persistColabMetadata: boolean;
}): ReadonlySet<string> {
  const hidden = new Set<string>();
  let collapseUntilLevel: number | null = null;
  for (const cell of input.cells) {
    const level = cell.cellType === "markdown" ? notebookHeadingLevel(cell.source) : null;
    if (level !== null) {
      if (collapseUntilLevel !== null && level <= collapseUntilLevel) {
        collapseUntilLevel = null;
      }
      const collapsed = notebookSectionIsCollapsed({
        sessionId: cell.sessionId,
        metadata: cell.metadata,
        localCollapsed: input.localCollapsed,
        persistColabMetadata: input.persistColabMetadata,
      });
      if (collapsed) collapseUntilLevel = level;
      continue;
    }
    if (collapseUntilLevel !== null) hidden.add(cell.sessionId);
  }
  return hidden;
}

export function notebookUsesColabMetadata(
  cells: ReadonlyArray<Pick<NotebookDraftCell, "metadata">>,
): boolean {
  return cells.some((cell) => "colab" in cell.metadata);
}

export function useNotebookOutline(cells: ReadonlyArray<NotebookDraftCell>) {
  return useMemo(() => notebookOutlineFromCells(cells), [cells]);
}
