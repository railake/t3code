import type { NotebookCellEdit } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source) && source.every((part) => typeof part === "string")) {
    return source.join("");
  }
  return "";
}

/** Same session identity the parser uses: persistent `id`, else `cell:<index>`. */
export function notebookCellSessionId(cell: unknown, index: number): string {
  const record = asRecord(cell);
  const id = record?.id;
  if (typeof id === "string" && id.trim().length > 0) return id;
  return `cell:${index}`;
}

/**
 * Jupyter stores source as an array of lines with a trailing "\\n" on every
 * line except the last. A single-line source with no newline stays one element.
 */
export function notebookSourceLines(source: string): string[] {
  if (source.length === 0) return [];
  const parts = source.split("\n");
  if (parts.length === 1) return [source];
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    if (i === parts.length - 1) {
      if (part.length > 0) lines.push(part);
      break;
    }
    lines.push(`${part}\n`);
  }
  return lines;
}

function detectIndent(rawText: string): number {
  const match = /\n( +)"/.exec(rawText);
  if (match?.[1] !== undefined && match[1].length > 0) return match[1].length;
  return 1;
}

function generateCellId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function metadataEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function editableCellType(cellType: NotebookCellEdit["cellType"]): "code" | "markdown" | "raw" {
  return cellType === "unknown" ? "raw" : cellType;
}

function buildNewCell(edit: NotebookCellEdit, nbformatMinor: number): Record<string, unknown> {
  const cellType = editableCellType(edit.cellType);
  const cell: Record<string, unknown> = {};
  if (nbformatMinor >= 5) {
    cell.id = edit.persistentId ?? generateCellId();
  }
  cell.cell_type = cellType;
  cell.metadata = { ...edit.metadata };
  cell.source = notebookSourceLines(edit.source);
  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }
  return cell;
}

function applyEditToOriginalCell(
  original: Record<string, unknown>,
  edit: NotebookCellEdit,
): Record<string, unknown> {
  const originalType =
    original.cell_type === "code" ||
    original.cell_type === "markdown" ||
    original.cell_type === "raw"
      ? original.cell_type
      : "unknown";

  // Unknown cells stay opaque: move/delete only; never rewrite source/metadata.
  if (originalType === "unknown" || edit.cellType === "unknown") {
    return { ...original };
  }

  const nextType = editableCellType(edit.cellType);
  const originalSource = sourceText(original.source);
  const originalMetadata = asRecord(original.metadata) ?? {};
  const sourceUnchanged = originalSource === edit.source;
  const typeUnchanged = originalType === nextType;
  const metadataUnchanged = metadataEqual(originalMetadata, edit.metadata);
  const keepOutputs = edit.outputs === "keep" && typeUnchanged && nextType === "code";

  if (sourceUnchanged && typeUnchanged && metadataUnchanged && keepOutputs) {
    return { ...original };
  }
  if (
    sourceUnchanged &&
    typeUnchanged &&
    metadataUnchanged &&
    edit.outputs === "keep" &&
    nextType !== "code"
  ) {
    return { ...original };
  }

  const next: Record<string, unknown> = { ...original };
  next.cell_type = nextType;
  if (!metadataUnchanged) {
    next.metadata = { ...edit.metadata };
  }
  if (!sourceUnchanged) {
    next.source = notebookSourceLines(edit.source);
  }

  const clearOutputs = edit.outputs === "clear" || (originalType === "code" && nextType !== "code");
  if (nextType === "code") {
    if (clearOutputs || originalType !== "code") {
      next.outputs = [];
      next.execution_count = null;
    }
  } else {
    delete next.outputs;
    delete next.execution_count;
  }

  return next;
}

export type ApplyNotebookEditsResult = {
  readonly text: string;
  readonly warnings: ReadonlyArray<string>;
};

/**
 * Merges cell-level edits onto the original notebook JSON text. Unknown
 * top-level keys and `metadata.widgets` stay untouched. Cells absent from
 * `edits` are deleted; unmatched edits become new cells.
 */
export function applyNotebookEdits(
  rawText: string,
  edits: ReadonlyArray<NotebookCellEdit>,
): ApplyNotebookEditsResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("invalid_notebook");
  }
  const root = asRecord(parsed);
  if (root === null || !Array.isArray(root.cells)) {
    throw new Error("invalid_notebook");
  }

  const nbformatMinor =
    typeof root.nbformat_minor === "number" && Number.isInteger(root.nbformat_minor)
      ? root.nbformat_minor
      : 0;

  const bySessionId = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < root.cells.length; index += 1) {
    const cell = root.cells[index];
    const record = asRecord(cell);
    if (record === null) continue;
    const sessionId = notebookCellSessionId(record, index);
    if (!bySessionId.has(sessionId)) {
      bySessionId.set(sessionId, record);
    }
  }

  const nextCells: Record<string, unknown>[] = [];
  for (const edit of edits) {
    const original = bySessionId.get(edit.sessionId);
    if (original !== undefined) {
      bySessionId.delete(edit.sessionId);
      nextCells.push(applyEditToOriginalCell(original, edit));
      continue;
    }
    if (edit.cellType === "unknown") {
      warnings.push(`Skipped new unknown cell '${edit.sessionId}'.`);
      continue;
    }
    nextCells.push(buildNewCell(edit, nbformatMinor));
  }

  // Rebuild from the parsed root so non-cell keys (including metadata.widgets) stay.
  root.cells = nextCells;

  const indent = detectIndent(rawText);
  const trailingNewline = rawText.endsWith("\n");
  const text = `${JSON.stringify(root, null, indent)}${trailingNewline ? "\n" : ""}`;
  return { text, warnings };
}
