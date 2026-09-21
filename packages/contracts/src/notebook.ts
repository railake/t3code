import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const NOTEBOOK_PATH_MAX_LENGTH = 512;

/** Complete `.ipynb` JSON is read within this budget; truncated text is never parsed. */
export const NOTEBOOK_DOCUMENT_MAX_BYTES = 32 * 1024 * 1024;

export const NotebookCellType = Schema.Literals(["code", "markdown", "raw", "unknown"]);
export type NotebookCellType = typeof NotebookCellType.Type;

export const NotebookMimePayload = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    mimeType: TrimmedNonEmptyString,
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    mimeType: TrimmedNonEmptyString,
    dataUrl: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("svg"),
    mimeType: TrimmedNonEmptyString,
    svg: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("html"),
    mimeType: TrimmedNonEmptyString,
    html: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("markdown"),
    mimeType: TrimmedNonEmptyString,
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("json"),
    mimeType: TrimmedNonEmptyString,
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("latex"),
    mimeType: TrimmedNonEmptyString,
    text: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("unsupported"),
    mimeType: TrimmedNonEmptyString,
    byteLength: NonNegativeInt,
  }),
]);
export type NotebookMimePayload = typeof NotebookMimePayload.Type;

export const NotebookOutput = Schema.Union([
  Schema.Struct({
    outputType: Schema.Literal("stream"),
    name: TrimmedNonEmptyString,
    text: Schema.String,
  }),
  Schema.Struct({
    outputType: Schema.Literal("error"),
    ename: Schema.String,
    evalue: Schema.String,
    traceback: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    outputType: Schema.Literal("display"),
    payloads: Schema.Array(NotebookMimePayload),
  }),
]);
export type NotebookOutput = typeof NotebookOutput.Type;

export const NotebookCellAttachment = Schema.Struct({
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  dataUrl: TrimmedNonEmptyString,
});
export type NotebookCellAttachment = typeof NotebookCellAttachment.Type;

export const NotebookCell = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  persistentId: Schema.NullOr(TrimmedNonEmptyString),
  cellType: NotebookCellType,
  language: Schema.optional(TrimmedNonEmptyString),
  source: Schema.String,
  sourceRevision: TrimmedNonEmptyString,
  executionCount: Schema.NullOr(NonNegativeInt),
  outputs: Schema.Array(NotebookOutput),
  hasAttachments: Schema.Boolean,
  attachments: Schema.Array(NotebookCellAttachment),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type NotebookCell = typeof NotebookCell.Type;

export const NotebookCapabilities = Schema.Struct({
  colabExecution: Schema.Boolean,
  colabExecutionUnavailableReason: Schema.optional(TrimmedNonEmptyString),
  editing: Schema.Boolean,
  interactiveWidgets: Schema.Boolean,
  interactivePlotly: Schema.Boolean,
});
export type NotebookCapabilities = typeof NotebookCapabilities.Type;

export const NotebookDocument = Schema.Struct({
  documentId: TrimmedNonEmptyString,
  revision: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  byteLength: NonNegativeInt,
  nbformat: NonNegativeInt,
  nbformatMinor: NonNegativeInt,
  language: Schema.optional(TrimmedNonEmptyString),
  cells: Schema.Array(NotebookCell),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  warnings: Schema.Array(Schema.String),
  readOnly: Schema.Boolean,
  capabilities: NotebookCapabilities,
});
export type NotebookDocument = typeof NotebookDocument.Type;

export const NotebookOpenInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(NOTEBOOK_PATH_MAX_LENGTH)),
});
export type NotebookOpenInput = typeof NotebookOpenInput.Type;

export const NotebookOpenFailure = Schema.Literals([
  "workspace_path_outside_root",
  "resolved_path_outside_root",
  "path_not_file",
  "binary_file",
  "operation_failed",
  "document_too_large",
  "invalid_notebook",
]);
export type NotebookOpenFailure = typeof NotebookOpenFailure.Type;

export const NotebookFileOperation = Schema.Literals([
  "realpath-workspace-root",
  "realpath-target",
  "open",
  "stat",
  "read",
  "close",
]);
export type NotebookFileOperation = typeof NotebookFileOperation.Type;

type NotebookOpenErrorContext = {
  readonly cwd: string;
  readonly relativePath: string;
  readonly failure: NotebookOpenFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: NotebookFileOperation;
  readonly operationPath?: string;
  readonly byteLength?: number;
  readonly maxBytes?: number;
  readonly cause?: unknown;
};

function notebookOpenErrorMessage(props: NotebookOpenErrorContext): string {
  switch (props.failure) {
    case "document_too_large":
      return `Notebook '${props.relativePath}' is ${props.byteLength?.toLocaleString() ?? "too large"} bytes; the viewer reads at most ${props.maxBytes?.toLocaleString() ?? "a bounded"} bytes so it never parses a truncated file.`;
    case "invalid_notebook":
      return `Notebook '${props.relativePath}' is not valid notebook JSON.`;
    case "binary_file":
      return `Notebook '${props.relativePath}' contains binary data and cannot be opened.`;
    case "path_not_file":
      return `Workspace path '${props.relativePath}' is not a file.`;
    default:
      return `Failed to open notebook '${props.relativePath}' in '${props.cwd}'.`;
  }
}

export class NotebookOpenError extends Schema.TaggedError<NotebookOpenError>()(
  "NotebookOpenError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(NotebookOpenFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(NotebookFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    byteLength: Schema.optional(NonNegativeInt),
    maxBytes: Schema.optional(NonNegativeInt),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: NotebookOpenErrorContext) {
    super({
      ...props,
      message: notebookOpenErrorMessage(props),
    } as any);
  }
}
