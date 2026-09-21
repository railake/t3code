import { sha256 } from "@noble/hashes/sha2";
import {
  NOTEBOOK_DOCUMENT_MAX_BYTES,
  type NotebookCell,
  type NotebookCellAttachment,
  type NotebookCapabilities,
  type NotebookDocument,
  type NotebookMimePayload,
  type NotebookOpenFailure,
  type NotebookOutput,
} from "@t3tools/contracts";
import * as Encoding from "effect/Encoding";

const NOTEBOOK_MIME_TYPES = new Set(["application/x-ipynb+json", "application/vnd.jupyter"]);

const COLAB_EXECUTION_UNAVAILABLE_REASON =
  "Google Colab API access is allowlisted and is not configured for this environment. A local Jupyter connection is not Colab support.";

const DEFAULT_CAPABILITIES = {
  colabExecution: false,
  colabExecutionUnavailableReason: COLAB_EXECUTION_UNAVAILABLE_REASON,
  editing: false,
  interactiveWidgets: false,
  interactivePlotly: false,
} as const satisfies NotebookCapabilities;

export type NotebookDocumentSuccess = {
  readonly _tag: "Success";
  readonly document: NotebookDocument;
  readonly preserved: {
    readonly widgetState: unknown;
    readonly unknownCellFields: ReadonlyArray<ReadonlyArray<string>>;
  };
};

export type NotebookDocumentFailure = {
  readonly _tag: "Failure";
  readonly failure: Extract<
    NotebookOpenFailure,
    "binary_file" | "document_too_large" | "invalid_notebook"
  >;
  readonly byteLength: number;
};

export type NotebookDocumentResult = NotebookDocumentSuccess | NotebookDocumentFailure;

const KNOWN_CELL_KEYS = new Set([
  "id",
  "cell_type",
  "source",
  "metadata",
  "outputs",
  "execution_count",
  "attachments",
]);

/** Classifies a captured or workspace file before generic JSON/text routing. */
export function isNotebookPreviewFile(file: {
  readonly name: string;
  readonly mimeType?: string;
}): boolean {
  const mime = file.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (NOTEBOOK_MIME_TYPES.has(mime)) return true;
  const name = file.name.toLowerCase();
  const extension = name.slice(name.lastIndexOf("."));
  if (extension !== ".ipynb") return false;
  return (
    mime.length === 0 ||
    mime === "application/octet-stream" ||
    mime === "text/plain" ||
    mime === "application/json" ||
    mime.endsWith("+json")
  );
}

export function isNotebookPreviewPath(path: string): boolean {
  const pathWithoutQuery = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return pathWithoutQuery.endsWith(".ipynb");
}

export function notebookSourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source) && source.every((part) => typeof part === "string")) {
    return source.join("");
  }
  return "";
}

function hexSha256(bytes: Uint8Array): string {
  return Encoding.encodeHex(sha256(bytes));
}

function hexSha256Text(value: string): string {
  return hexSha256(new TextEncoder().encode(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function payloadByteLength(value: unknown): number {
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, part) => sum + payloadByteLength(part), 0);
  }
  if (value === null || value === undefined) return 0;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function imageDataUrl(mimeType: string, value: unknown): string {
  const data = notebookSourceText(value).replace(/\s+/g, "");
  return data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
}

function mimePayload(mimeType: string, value: unknown): NotebookMimePayload {
  const text = notebookSourceText(value);
  if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") {
    return { kind: "image", mimeType, dataUrl: imageDataUrl(mimeType, value) };
  }
  if (mimeType === "image/svg+xml" || mimeType === "image/svg") {
    return { kind: "svg", mimeType, svg: text };
  }
  if (mimeType === "text/html") {
    return { kind: "html", mimeType, html: text };
  }
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown") {
    return { kind: "markdown", mimeType, text };
  }
  if (mimeType === "text/latex" || mimeType === "application/x-latex") {
    return { kind: "latex", mimeType, text };
  }
  if (mimeType === "application/json" || mimeType.endsWith("+json")) {
    if (mimeType.includes("vnd.plotly") || mimeType.includes("widget")) {
      return { kind: "unsupported", mimeType, byteLength: payloadByteLength(value) };
    }
    const jsonText =
      typeof value === "string" ||
      (Array.isArray(value) && value.every((part) => typeof part === "string"))
        ? text
        : JSON.stringify(value, null, 2);
    return { kind: "json", mimeType, text: jsonText };
  }
  if (mimeType === "application/javascript" || mimeType === "text/javascript") {
    return { kind: "unsupported", mimeType, byteLength: payloadByteLength(value) };
  }
  if (mimeType.startsWith("text/") || mimeType === "application/vnd.jupyter.stdout") {
    return { kind: "text", mimeType, text };
  }
  return { kind: "unsupported", mimeType, byteLength: payloadByteLength(value) };
}

const DISPLAY_KIND_PRIORITY = [
  "html",
  "svg",
  "image",
  "markdown",
  "latex",
  "json",
  "text",
] as const satisfies ReadonlyArray<NotebookMimePayload["kind"]>;

function htmlLooksScripted(payload: NotebookMimePayload): boolean {
  return payload.kind === "html" && /<script[\s>/]/i.test(payload.html);
}

/**
 * Jupyter shows one richest MIME bundle, not every representation. Scripted
 * HTML (Plotly, widgets) yields to a static image when the cell saved one.
 */
export function preferredNotebookDisplayPayloads(
  payloads: ReadonlyArray<NotebookMimePayload>,
): ReadonlyArray<NotebookMimePayload> {
  const images = payloads.filter((payload) => payload.kind === "image");
  const skipScriptedHtml = payloads.some(htmlLooksScripted);
  for (const kind of DISPLAY_KIND_PRIORITY) {
    if (kind === "html" && skipScriptedHtml && images.length > 0) continue;
    if (kind === "html" && skipScriptedHtml) continue;
    const chosen = payloads.filter((payload) => payload.kind === kind);
    if (chosen.length > 0) return chosen;
  }
  const unsupported = payloads.filter((payload) => payload.kind === "unsupported");
  return unsupported.length > 0 ? unsupported.slice(0, 1) : [];
}

function cellAttachments(value: unknown): ReadonlyArray<NotebookCellAttachment> {
  const record = asRecord(value);
  if (record === null) return [];
  const attachments: NotebookCellAttachment[] = [];
  for (const [name, bundle] of Object.entries(record)) {
    if (name.trim().length === 0) continue;
    const mimeBundle = asRecord(bundle);
    if (mimeBundle === null) continue;
    const mimeEntries = Object.entries(mimeBundle);
    const preferred =
      mimeEntries.find(
        ([mimeType]) => mimeType.startsWith("image/") && mimeType !== "image/svg+xml",
      ) ??
      mimeEntries.find(([mimeType]) => mimeType === "image/svg+xml" || mimeType === "image/svg") ??
      mimeEntries[0];
    if (preferred === undefined) continue;
    const [mimeType, payload] = preferred;
    if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") {
      attachments.push({ name, mimeType, dataUrl: imageDataUrl(mimeType, payload) });
      continue;
    }
    if (mimeType === "image/svg+xml" || mimeType === "image/svg") {
      const svg = notebookSourceText(payload);
      attachments.push({
        name,
        mimeType,
        dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      });
    }
  }
  return attachments;
}

export function rewriteNotebookMarkdownAttachments(
  source: string,
  attachments: ReadonlyArray<Pick<NotebookCellAttachment, "name" | "dataUrl">>,
): string {
  if (attachments.length === 0) return source;
  const byName = new Map<string, string>();
  for (const attachment of attachments) {
    byName.set(attachment.name, attachment.dataUrl);
    try {
      byName.set(decodeURIComponent(attachment.name), attachment.dataUrl);
    } catch {
      // Keep the raw attachment name when it is not URI-encoded.
    }
  }
  const resolve = (rawName: string): string | undefined => {
    const trimmed = rawName.trim();
    return byName.get(trimmed) ?? byName.get(decodeURIComponentSafe(trimmed));
  };
  return source
    .replace(/\]\(\s*attachment:([^)\s]+)\s*\)/gi, (match, rawName: string) => {
      const dataUrl = resolve(rawName);
      return dataUrl === undefined ? match : `](${dataUrl})`;
    })
    .replace(/\bsrc=(["'])attachment:([^"']+)\1/gi, (match, quote: string, rawName: string) => {
      const dataUrl = resolve(rawName);
      return dataUrl === undefined ? match : `src=${quote}${dataUrl}${quote}`;
    });
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Jupyter also accepts TeX delimiters `\[ \]` / `\( \)` in markdown cells. */
export function normalizeNotebookMarkdownMath(source: string): string {
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, tex: string) => `$$${tex}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, tex: string) => `$${tex}$`);
}

export type NotebookAnsiSpan = {
  readonly text: string;
  readonly color?: string;
  readonly fontWeight?: "bold";
};

const ANSI_COLORS: Record<number, string> = {
  30: "#52525b",
  31: "#ef4444",
  32: "#22c55e",
  33: "#eab308",
  34: "#3b82f6",
  35: "#d946ef",
  36: "#06b6d4",
  37: "#e4e4e7",
  90: "#a1a1aa",
  91: "#f87171",
  92: "#4ade80",
  93: "#facc15",
  94: "#60a5fa",
  95: "#e879f9",
  96: "#22d3ee",
  97: "#fafafa",
};

export function stripNotebookAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "");
}

function ansiSpan(text: string, color: string | undefined, bold: boolean): NotebookAnsiSpan | null {
  const cleaned = stripNotebookAnsi(text);
  if (cleaned.length === 0) return null;
  return {
    text: cleaned,
    ...(color === undefined ? {} : { color }),
    ...(bold ? { fontWeight: "bold" as const } : {}),
  };
}

/** Color SGR sequences for tracebacks; other CSI/OSC codes are stripped. */
export function notebookAnsiSpans(text: string): ReadonlyArray<NotebookAnsiSpan> {
  const withoutOsc = text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
  const spans: NotebookAnsiSpan[] = [];
  let lastIndex = 0;
  let color: string | undefined;
  let bold = false;
  const sgr = /\u001b\[([0-9;]*)m/g;
  for (const match of withoutOsc.matchAll(sgr)) {
    const index = match.index ?? 0;
    const preceding = ansiSpan(withoutOsc.slice(lastIndex, index), color, bold);
    if (preceding) spans.push(preceding);
    const rawCodes = match[1] ?? "";
    const codes = rawCodes.length === 0 ? [0] : rawCodes.split(";").map((part) => Number(part));
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else {
        const mapped = ANSI_COLORS[code];
        if (mapped !== undefined) color = mapped;
      }
    }
    lastIndex = index + match[0].length;
  }
  const trailing = ansiSpan(withoutOsc.slice(lastIndex), color, bold);
  if (trailing) spans.push(trailing);
  return spans;
}

function normalizeOutput(output: unknown): NotebookOutput | null {
  const record = asRecord(output);
  if (record === null) return null;
  const outputType = typeof record.output_type === "string" ? record.output_type : "";
  if (outputType === "stream") {
    const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "stdout";
    return { outputType: "stream", name, text: notebookSourceText(record.text) };
  }
  if (outputType === "error") {
    return {
      outputType: "error",
      ename: typeof record.ename === "string" ? record.ename : "",
      evalue: typeof record.evalue === "string" ? record.evalue : "",
      traceback: Array.isArray(record.traceback)
        ? record.traceback.filter((line): line is string => typeof line === "string")
        : [],
    };
  }
  if (
    outputType === "display_data" ||
    outputType === "execute_result" ||
    outputType === "update_display_data"
  ) {
    const data = asRecord(record.data) ?? {};
    const payloads = Object.entries(data).map(([mimeType, value]) => mimePayload(mimeType, value));
    return { outputType: "display", payloads };
  }
  return {
    outputType: "display",
    payloads: [
      {
        kind: "unsupported",
        mimeType: outputType || "unknown",
        byteLength: payloadByteLength(output),
      },
    ],
  };
}

function cellTypeOf(value: unknown): NotebookCell["cellType"] {
  if (value === "code" || value === "markdown" || value === "raw") return value;
  return "unknown";
}

function metadataForWire(metadata: Record<string, unknown>): {
  readonly metadata: Record<string, unknown>;
  readonly widgetState: unknown;
} {
  if (!("widgets" in metadata)) {
    return { metadata: { ...metadata }, widgetState: undefined };
  }
  const { widgets, ...rest } = metadata;
  return { metadata: { ...rest, widgets: { present: true } }, widgetState: widgets };
}

function languageFromMetadata(
  metadata: Record<string, unknown>,
  cellMetadata: Record<string, unknown>,
): string | undefined {
  const cellLanguage = cellMetadata.language;
  if (typeof cellLanguage === "string" && cellLanguage.trim().length > 0) return cellLanguage;
  const kernelspec = asRecord(metadata.kernelspec);
  const language = kernelspec?.language;
  return typeof language === "string" && language.trim().length > 0 ? language : undefined;
}

function normalizeCell(
  cell: unknown,
  index: number,
  notebookMetadata: Record<string, unknown>,
): { readonly cell: NotebookCell; readonly extraKeys: ReadonlyArray<string> } {
  const record = asRecord(cell) ?? {};
  const extraKeys = Object.keys(record).filter((key) => !KNOWN_CELL_KEYS.has(key));
  const persistentId =
    typeof record.id === "string" && record.id.trim().length > 0 ? record.id : null;
  const metadata = asRecord(record.metadata) ?? {};
  const source = notebookSourceText(record.source);
  const outputs = Array.isArray(record.outputs)
    ? record.outputs
        .map(normalizeOutput)
        .filter((output): output is NotebookOutput => output !== null)
    : [];
  const executionCount =
    typeof record.execution_count === "number" && Number.isInteger(record.execution_count)
      ? record.execution_count
      : null;
  const language = languageFromMetadata(notebookMetadata, metadata);
  const attachments = cellAttachments(record.attachments);
  return {
    extraKeys,
    cell: {
      sessionId: persistentId ?? `cell:${index}`,
      persistentId,
      cellType: cellTypeOf(record.cell_type),
      ...(language === undefined ? {} : { language }),
      source,
      sourceRevision: hexSha256Text(source),
      executionCount,
      outputs,
      hasAttachments: attachments.length > 0,
      attachments,
      metadata,
    },
  };
}

function warningsFor(input: {
  readonly nbformat: number;
  readonly unknownCellCount: number;
  readonly hasWidgets: boolean;
  readonly hasPlotly: boolean;
  readonly hasJavascript: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.nbformat !== 4) {
    warnings.push(
      `This notebook uses nbformat ${input.nbformat}. Unknown fields stay on disk; editing requires nbformat 4.`,
    );
  }
  if (input.unknownCellCount > 0) {
    warnings.push(
      "This notebook contains cell types this viewer does not edit. Original fields were left intact.",
    );
  }
  if (input.hasWidgets) {
    warnings.push("Interactive widgets are preserved on disk and are not run in this viewer.");
  }
  if (input.hasPlotly) {
    warnings.push(
      "Plotly interactivity is not available; static fallbacks are shown when present.",
    );
  }
  if (input.hasJavascript) {
    warnings.push("JavaScript outputs are not executed.");
  }
  return warnings;
}

/**
 * Parses complete notebook bytes into a rendering model. Callers must pass the
 * whole file; a truncated JSON prefix is rejected rather than displayed.
 */
export function notebookDocumentFromBytes(input: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}): NotebookDocumentResult {
  const byteLength = input.bytes.byteLength;
  if (byteLength > NOTEBOOK_DOCUMENT_MAX_BYTES) {
    return { _tag: "Failure", failure: "document_too_large", byteLength };
  }
  if (input.bytes.includes(0)) {
    return { _tag: "Failure", failure: "binary_file", byteLength };
  }
  const text = decodeUtf8(input.bytes);
  if (text === null) {
    return { _tag: "Failure", failure: "invalid_notebook", byteLength };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { _tag: "Failure", failure: "invalid_notebook", byteLength };
  }
  const root = asRecord(parsed);
  if (root === null || !Array.isArray(root.cells)) {
    return { _tag: "Failure", failure: "invalid_notebook", byteLength };
  }
  const notebookMetadata = asRecord(root.metadata) ?? {};
  const { metadata, widgetState } = metadataForWire(notebookMetadata);
  const normalizedCells = root.cells.map((cell, index) =>
    normalizeCell(cell, index, notebookMetadata),
  );
  const cells = normalizedCells.map((entry) => entry.cell);
  const unknownCellFields = normalizedCells.map((entry) => entry.extraKeys);
  const hasPlotly = cells.some((cell) =>
    cell.outputs.some(
      (output) =>
        output.outputType === "display" &&
        output.payloads.some((payload) => payload.mimeType.includes("vnd.plotly")),
    ),
  );
  const hasJavascript = cells.some((cell) =>
    cell.outputs.some(
      (output) =>
        output.outputType === "display" &&
        output.payloads.some((payload) => payload.mimeType.includes("javascript")),
    ),
  );
  const nbformat =
    typeof root.nbformat === "number" && Number.isInteger(root.nbformat) ? root.nbformat : 0;
  const nbformatMinor =
    typeof root.nbformat_minor === "number" && Number.isInteger(root.nbformat_minor)
      ? root.nbformat_minor
      : 0;
  const language = languageFromMetadata(notebookMetadata, {});
  const unknownCellCount = cells.filter((cell) => cell.cellType === "unknown").length;
  const warnings = warningsFor({
    nbformat,
    unknownCellCount,
    hasWidgets: widgetState !== undefined,
    hasPlotly,
    hasJavascript,
  });
  return {
    _tag: "Success",
    preserved: { widgetState, unknownCellFields },
    document: {
      documentId: hexSha256Text(`${input.cwd}\0${input.relativePath}`),
      revision: hexSha256(input.bytes),
      relativePath: input.relativePath,
      byteLength,
      nbformat,
      nbformatMinor,
      ...(language === undefined ? {} : { language }),
      cells,
      metadata,
      warnings,
      readOnly: nbformat !== 4,
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        editing: nbformat === 4,
      },
    },
  };
}

export {
  applyNotebookEdits,
  notebookCellSessionId,
  notebookSourceLines,
  type ApplyNotebookEditsResult,
} from "./notebookEdits.ts";
