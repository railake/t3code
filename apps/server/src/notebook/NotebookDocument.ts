// @effect-diagnostics nodeBuiltinImport:off
/**
 * NotebookDocument - reads and saves workspace `.ipynb` files within a document budget.
 *
 * Generic project file reads truncate at 1 MiB. Notebooks must never be parsed
 * from a truncated prefix, so this service stats first and refuses oversized
 * files before reading. Saves merge cell edits onto the original on-disk JSON
 * so unknown fields and widget state survive.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  NOTEBOOK_DOCUMENT_MAX_BYTES,
  NotebookOpenError,
  NotebookSaveError,
  type NotebookDocument as NotebookDocumentModel,
  type NotebookOpenInput,
  type NotebookSaveInput,
} from "@t3tools/contracts";
import { applyNotebookEdits, notebookDocumentFromBytes } from "@t3tools/shared/notebook";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

export class NotebookDocument extends Context.Service<
  NotebookDocument,
  {
    readonly open: (
      input: NotebookOpenInput,
    ) => Effect.Effect<
      NotebookDocumentModel,
      | NotebookOpenError
      | WorkspaceFileSystem.WorkspaceFileSystemError
      | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    readonly save: (
      input: NotebookSaveInput,
    ) => Effect.Effect<
      NotebookDocumentModel,
      | NotebookSaveError
      | WorkspaceFileSystem.WorkspaceFileSystemError
      | WorkspacePaths.WorkspacePathOutsideRootError
    >;
  }
>()("t3/notebook/NotebookDocument") {}

type ResolvedNotebookTarget = {
  readonly relativePath: string;
  readonly realTargetPath: string;
};

const readNotebookBytes = Effect.fn("NotebookDocument.readNotebookBytes")(function* (input: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly realTargetPath: string;
}) {
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        NodeFSP.open(
          input.realTargetPath,
          NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0),
        ),
      catch: (cause) =>
        new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: input.realTargetPath,
          operationPath: input.realTargetPath,
          operation: "open",
          cause,
        }),
    }),
    (handle) =>
      Effect.gen(function* () {
        const stat = yield* Effect.tryPromise({
          try: () => handle.stat(),
          catch: (cause) =>
            new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: input.realTargetPath,
              operationPath: input.realTargetPath,
              operation: "stat",
              cause,
            }),
        });
        if (!stat.isFile()) {
          return yield* new WorkspaceFileSystem.WorkspacePathNotFileError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: input.realTargetPath,
          });
        }
        if (stat.size > NOTEBOOK_DOCUMENT_MAX_BYTES) {
          return yield* new NotebookOpenError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            failure: "document_too_large",
            resolvedPath: input.realTargetPath,
            byteLength: stat.size,
            maxBytes: NOTEBOOK_DOCUMENT_MAX_BYTES,
          });
        }

        const buffer = Buffer.alloc(stat.size);
        const { bytesRead } = yield* Effect.tryPromise({
          try: () => handle.read(buffer, 0, stat.size, 0),
          catch: (cause) =>
            new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: input.realTargetPath,
              operationPath: input.realTargetPath,
              operation: "read",
              cause,
            }),
        });
        return buffer.subarray(0, bytesRead);
      }),
    (handle) =>
      Effect.tryPromise({
        try: () => handle.close(),
        catch: (cause) =>
          new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: input.realTargetPath,
            operationPath: input.realTargetPath,
            operation: "close",
            cause,
          }),
      }),
  );
});

async function renameOverTarget(tempPath: string, targetPath: string): Promise<void> {
  try {
    await NodeFSP.rename(tempPath, targetPath);
  } catch (cause) {
    const code =
      cause !== null && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: unknown }).code)
        : undefined;
    if (code !== "EPERM" && code !== "EEXIST" && code !== "EACCES") {
      throw cause;
    }
    // Windows cannot always rename over an existing file; copy then unlink.
    await NodeFSP.copyFile(tempPath, targetPath);
    await NodeFSP.unlink(tempPath);
  }
}

function toSaveError(
  input: Pick<NotebookSaveInput, "cwd" | "relativePath">,
  error: NotebookOpenError,
): NotebookSaveError {
  return new NotebookSaveError({
    cwd: input.cwd,
    relativePath: input.relativePath,
    failure: error.failure ?? "operation_failed",
    ...(error.resolvedPath === undefined ? {} : { resolvedPath: error.resolvedPath }),
    ...(error.byteLength === undefined ? {} : { byteLength: error.byteLength }),
    ...(error.maxBytes === undefined ? {} : { maxBytes: error.maxBytes }),
    cause: error,
  });
}

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const resolveWithinRoot = Effect.fn("NotebookDocument.resolveWithinRoot")(function* (input: {
    readonly cwd: string;
    readonly relativePath: string;
  }) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(input.cwd),
      catch: (cause) =>
        new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: input.cwd,
          operation: "realpath-workspace-root",
          cause,
        }),
    });
    const realTargetPath = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(target.absolutePath),
      catch: (cause) =>
        new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "realpath-target",
          cause,
        }),
    });
    const relativeRealPath = path.relative(realWorkspaceRoot, realTargetPath);
    if (
      relativeRealPath.startsWith(`..${path.sep}`) ||
      relativeRealPath === ".." ||
      path.isAbsolute(relativeRealPath)
    ) {
      return yield* new WorkspaceFileSystem.WorkspaceFilePathEscapeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedWorkspaceRoot: realWorkspaceRoot,
        resolvedPath: realTargetPath,
      });
    }
    return { relativePath: target.relativePath, realTargetPath };
  });

  const resolveOpenTarget = Effect.fn("NotebookDocument.resolveOpenTarget")(function* (
    input: NotebookOpenInput,
  ) {
    const requestedPath = input.relativePath.trim();
    if (path.isAbsolute(requestedPath)) {
      const realTargetPath = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(requestedPath),
        catch: (cause) =>
          new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: requestedPath,
            operationPath: requestedPath,
            operation: "realpath-target",
            cause,
          }),
      });
      return { relativePath: requestedPath, realTargetPath };
    }
    return yield* resolveWithinRoot(input);
  });

  const open: NotebookDocument["Service"]["open"] = Effect.fn("NotebookDocument.open")(
    function* (input) {
      const target = yield* resolveOpenTarget(input);
      const bytes = yield* readNotebookBytes({
        cwd: input.cwd,
        relativePath: input.relativePath,
        realTargetPath: target.realTargetPath,
      });
      const parsed = notebookDocumentFromBytes({
        cwd: input.cwd,
        relativePath: target.relativePath,
        bytes,
      });
      if (parsed._tag === "Failure") {
        return yield* new NotebookOpenError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: parsed.failure,
          resolvedPath: target.realTargetPath,
          byteLength: parsed.byteLength,
          maxBytes: NOTEBOOK_DOCUMENT_MAX_BYTES,
        });
      }
      return parsed.document;
    },
  );

  const save: NotebookDocument["Service"]["save"] = Effect.fn("NotebookDocument.save")(
    function* (input) {
      const requestedPath = input.relativePath.trim();
      if (path.isAbsolute(requestedPath)) {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: "read_only_document",
        });
      }

      const target = yield* resolveWithinRoot(input);
      const bytes = yield* readNotebookBytes({
        cwd: input.cwd,
        relativePath: input.relativePath,
        realTargetPath: target.realTargetPath,
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "NotebookOpenError" ? toSaveError(input, error) : error,
        ),
      );

      const parsed = notebookDocumentFromBytes({
        cwd: input.cwd,
        relativePath: target.relativePath,
        bytes,
      });
      if (parsed._tag === "Failure") {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: parsed.failure,
          resolvedPath: target.realTargetPath,
          byteLength: parsed.byteLength,
          maxBytes: NOTEBOOK_DOCUMENT_MAX_BYTES,
        });
      }
      if (parsed.document.readOnly || !parsed.document.capabilities.editing) {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: "read_only_document",
          resolvedPath: target.realTargetPath,
        });
      }
      if (parsed.document.revision !== input.baseRevision) {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: "revision_conflict",
          resolvedPath: target.realTargetPath,
          currentRevision: parsed.document.revision,
        });
      }

      const rawText = new TextDecoder("utf-8").decode(bytes);
      let merged: ReturnType<typeof applyNotebookEdits>;
      try {
        merged = applyNotebookEdits(rawText, input.cells);
      } catch (cause) {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: "invalid_notebook",
          resolvedPath: target.realTargetPath,
          cause,
        });
      }

      const tempPath = NodePath.join(
        NodePath.dirname(target.realTargetPath),
        `${NodePath.basename(target.realTargetPath)}.t3-tmp-${NodeCrypto.randomUUID()}`,
      );
      yield* Effect.tryPromise({
        try: async () => {
          await NodeFSP.writeFile(tempPath, merged.text, "utf8");
          await renameOverTarget(tempPath, target.realTargetPath);
        },
        catch: (cause) => {
          void NodeFSP.unlink(tempPath).catch(() => undefined);
          return new NotebookSaveError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            failure: "write_failed",
            resolvedPath: target.realTargetPath,
            operationPath: tempPath,
            cause,
          });
        },
      });

      yield* workspaceEntries.refresh(input.cwd);

      const writtenBytes = yield* readNotebookBytes({
        cwd: input.cwd,
        relativePath: input.relativePath,
        realTargetPath: target.realTargetPath,
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "NotebookOpenError" ? toSaveError(input, error) : error,
        ),
      );
      const reparsed = notebookDocumentFromBytes({
        cwd: input.cwd,
        relativePath: target.relativePath,
        bytes: writtenBytes,
      });
      if (reparsed._tag === "Failure") {
        return yield* new NotebookSaveError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          failure: reparsed.failure,
          resolvedPath: target.realTargetPath,
          byteLength: reparsed.byteLength,
          maxBytes: NOTEBOOK_DOCUMENT_MAX_BYTES,
        });
      }
      return reparsed.document;
    },
  );

  return NotebookDocument.of({ open, save });
});

export const layer = Layer.effect(NotebookDocument, make);
