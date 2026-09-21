import type { NotebookCell } from "@t3tools/contracts";

import { fileContentRevision } from "../fileContentRevision";

/**
 * Pierre infers highlighting from the file name, so each cell needs one. The
 * notebook path is kept in the name because the editor also uses it to decide
 * whether the attached document changed identity.
 */
const EXTENSION_BY_LANGUAGE: Readonly<Record<string, string>> = {
  bash: "sh",
  c: "c",
  clojure: "clj",
  cpp: "cpp",
  csharp: "cs",
  fsharp: "fs",
  go: "go",
  haskell: "hs",
  java: "java",
  javascript: "js",
  julia: "jl",
  kotlin: "kt",
  lua: "lua",
  markdown: "md",
  matlab: "m",
  ocaml: "ml",
  php: "php",
  python: "py",
  r: "r",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  shell: "sh",
  sql: "sql",
  swift: "swift",
  typescript: "ts",
};

export function notebookCellExtension(language: string | undefined): string {
  if (language === undefined) return "txt";
  return EXTENSION_BY_LANGUAGE[language.toLowerCase()] ?? "txt";
}

export function notebookCellFileName(
  relativePath: string,
  cell: Pick<NotebookCell, "cellType" | "language" | "sessionId">,
  documentLanguage: string | undefined,
): string {
  const extension =
    cell.cellType === "markdown"
      ? "md"
      : cell.cellType === "code"
        ? notebookCellExtension(cell.language ?? documentLanguage)
        : "txt";
  return `${relativePath}/${cell.sessionId}.${extension}`;
}

interface EditorFileIdentity {
  readonly cacheKey?: string;
  readonly contents: string;
}

/**
 * The Editor caches one TextDocument — and with it one undo stack — per cache
 * key, so a cell keeps its history as focus moves across the notebook. The key
 * must stay stable while the user types, or every keystroke would rebuild the
 * document and drop that history: keep the attached editor's own key whenever
 * its text already matches the draft. Source that arrives from anywhere else
 * (a structural undo, a reload from disk) mints a new key on purpose, because
 * the cached document no longer describes that cell.
 */
export function notebookCellEditorCacheKey(
  storeKey: string,
  sessionId: string,
  source: string,
  editorFile: EditorFileIdentity | undefined,
): string {
  const prefix = `notebook:${storeKey}:${sessionId}#`;
  if (editorFile?.cacheKey?.startsWith(prefix) === true && editorFile.contents === source) {
    return editorFile.cacheKey;
  }
  return `${prefix}${fileContentRevision(source)}`;
}
