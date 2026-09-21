// @effect-diagnostics nodeBuiltinImport:off
/**
 * NotebookDocument - reads a complete workspace `.ipynb` within a document budget.
 *
 * Generic project file reads truncate at 1 MiB. Notebooks must never be parsed
 * from a truncated prefix, so this service stats first and refuses oversized
 * files before reading.
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import {
  NOTEBOOK_DOCUMENT_MAX_BYTES,
  NotebookOpenError,
  type NotebookDocument as NotebookDocumentModel,
  type NotebookOpenInput,
} from "@t3tools/contracts";
import { notebookDocumentFromBytes } from "@t3tools/shared/notebook";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

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
  }
>()("t3/notebook/NotebookDocument") {}

export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;

  const resolveReadTarget = Effect.fn("NotebookDocument.resolveReadTarget")(function* (
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

  const open: NotebookDocument["Service"]["open"] = Effect.fn("NotebookDocument.open")(
    function* (input) {
      const target = yield* resolveReadTarget(input);
      const realTargetPath = target.realTargetPath;

      return yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () =>
            NodeFSP.open(
              realTargetPath,
              NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NONBLOCK ?? 0),
            ),
          catch: (cause) =>
            new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
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
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "stat",
                  cause,
                }),
            });
            if (!stat.isFile()) {
              return yield* new WorkspaceFileSystem.WorkspacePathNotFileError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
              });
            }
            if (stat.size > NOTEBOOK_DOCUMENT_MAX_BYTES) {
              return yield* new NotebookOpenError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                failure: "document_too_large",
                resolvedPath: realTargetPath,
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
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "read",
                  cause,
                }),
            });
            const parsed = notebookDocumentFromBytes({
              cwd: input.cwd,
              relativePath: target.relativePath,
              bytes: buffer.subarray(0, bytesRead),
            });
            if (parsed._tag === "Failure") {
              return yield* new NotebookOpenError({
                cwd: input.cwd,
                relativePath: input.relativePath,
                failure: parsed.failure,
                resolvedPath: realTargetPath,
                byteLength: parsed.byteLength,
                maxBytes: NOTEBOOK_DOCUMENT_MAX_BYTES,
              });
            }
            return parsed.document;
          }),
        (handle) =>
          Effect.tryPromise({
            try: () => handle.close(),
            catch: (cause) =>
              new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "close",
                cause,
              }),
          }),
      );
    },
  );

  return NotebookDocument.of({ open });
});

export const layer = Layer.effect(NotebookDocument, make);
