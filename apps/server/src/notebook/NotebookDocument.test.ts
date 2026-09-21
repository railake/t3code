import * as NodeServices from "@effect/platform-node/NodeServices";
import { NOTEBOOK_DOCUMENT_MAX_BYTES } from "@t3tools/contracts";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as NotebookDocument from "./NotebookDocument.ts";

const ProjectLayer = NotebookDocument.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-notebook-document-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-notebook-document-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

const notebookJson = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { language: "python", name: "python3" } },
  cells: [
    {
      id: "code-1",
      cell_type: "code",
      source: ["print(1)\n"],
      metadata: {},
      outputs: [{ output_type: "stream", name: "stdout", text: "1\n" }],
      execution_count: 1,
    },
  ],
});

it.layer(TestLayer, { excludeTestServices: true })("NotebookDocumentLive", (it) => {
  describe("open", () => {
    it.effect(
      "reads a notebook larger than the generic 1 MiB text preview without truncating",
      () =>
        Effect.gen(function* () {
          const notebooks = yield* NotebookDocument.NotebookDocument;
          const cwd = yield* makeTempDir;
          const padding = "a".repeat(1.5 * 1024 * 1024);
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          const large = JSON.stringify({
            nbformat: 4,
            nbformat_minor: 5,
            metadata: { padding },
            cells: [{ cell_type: "markdown", source: "# Hello", metadata: {} }],
          });
          yield* writeTextFile(cwd, "notes/large.ipynb", large);

          const result = yield* notebooks.open({ cwd, relativePath: "notes/large.ipynb" });

          expect(result.byteLength).toBeGreaterThan(1024 * 1024);
          expect(result.cells[0]?.source).toBe("# Hello");
          expect(result.metadata.padding).toBe(padding);
          expect(result.capabilities.colabExecution).toBe(false);
        }),
    );

    it.effect("does not rewrite the notebook file", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "demo.ipynb", notebookJson);
        const before = yield* fileSystem.readFileString(path.join(cwd, "demo.ipynb"));

        yield* notebooks.open({ cwd, relativePath: "demo.ipynb" });

        const after = yield* fileSystem.readFileString(path.join(cwd, "demo.ipynb"));
        expect(after).toBe(before);
      }),
    );

    it.effect("rejects a truncated JSON prefix instead of parsing it", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "cut.ipynb", notebookJson.slice(0, 40));

        const error = yield* notebooks.open({ cwd, relativePath: "cut.ipynb" }).pipe(Effect.flip);

        expect(error._tag).toBe("NotebookOpenError");
        if (error._tag !== "NotebookOpenError") return;
        expect(error.failure).toBe("invalid_notebook");
      }),
    );

    it.effect("refuses an oversized notebook before reading it into the editor path", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "huge.ipynb");
        yield* fileSystem.writeFile(
          absolutePath,
          new Uint8Array(NOTEBOOK_DOCUMENT_MAX_BYTES + 1).fill(97),
        );

        const error = yield* notebooks.open({ cwd, relativePath: "huge.ipynb" }).pipe(Effect.flip);

        expect(error._tag).toBe("NotebookOpenError");
        if (error._tag !== "NotebookOpenError") return;
        expect(error.failure).toBe("document_too_large");
        expect(error.byteLength).toBe(NOTEBOOK_DOCUMENT_MAX_BYTES + 1);
      }),
    );
  });

  describe("save", () => {
    it.effect("returns a new revision after merging cell edits", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const raw = `${JSON.stringify(
          {
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {
              widgets: { keep: true },
              kernelspec: { language: "python", name: "python3" },
            },
            cells: [
              {
                id: "code-1",
                cell_type: "code",
                source: ["print(1)\n"],
                metadata: {},
                outputs: [{ output_type: "stream", name: "stdout", text: "1\n" }],
                execution_count: 1,
                mystery: true,
              },
            ],
          },
          null,
          1,
        )}\n`;
        yield* writeTextFile(cwd, "demo.ipynb", raw);
        const opened = yield* notebooks.open({ cwd, relativePath: "demo.ipynb" });

        const saved = yield* notebooks.save({
          cwd,
          relativePath: "demo.ipynb",
          baseRevision: opened.revision,
          cells: [
            {
              sessionId: "code-1",
              persistentId: "code-1",
              cellType: "code",
              source: "print(2)\n",
              metadata: {},
              outputs: "keep",
            },
          ],
        });

        expect(saved.revision).not.toBe(opened.revision);
        expect(saved.cells[0]?.source).toBe("print(2)\n");
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const onDisk = JSON.parse(
          yield* fileSystem.readFileString(path.join(cwd, "demo.ipynb")),
        ) as {
          metadata: { widgets: unknown };
          cells: Array<Record<string, unknown>>;
        };
        expect(onDisk.metadata.widgets).toEqual({ keep: true });
        expect(onDisk.cells[0]?.mystery).toBe(true);
        expect(onDisk.cells[0]?.source).toEqual(["print(2)\n"]);
      }),
    );

    it.effect("conflicts when the file changed underneath", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "demo.ipynb", notebookJson);
        const opened = yield* notebooks.open({ cwd, relativePath: "demo.ipynb" });
        yield* writeTextFile(
          cwd,
          "demo.ipynb",
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.stringify({
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {},
            cells: [
              {
                id: "code-1",
                cell_type: "code",
                source: ["print(changed)\n"],
                metadata: {},
                outputs: [],
                execution_count: null,
              },
            ],
          }),
        );

        const error = yield* notebooks
          .save({
            cwd,
            relativePath: "demo.ipynb",
            baseRevision: opened.revision,
            cells: [
              {
                sessionId: "code-1",
                persistentId: "code-1",
                cellType: "code",
                source: "print(9)\n",
                metadata: {},
                outputs: "keep",
              },
            ],
          })
          .pipe(Effect.flip);

        expect(error._tag).toBe("NotebookSaveError");
        if (error._tag !== "NotebookSaveError") return;
        expect(error.failure).toBe("revision_conflict");
        expect(error.message).toMatch(/changed on disk/i);
        expect(error.currentRevision).toBeTruthy();
      }),
    );

    it.effect("rejects absolute paths as read-only documents", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const absolutePath = path.join(cwd, "demo.ipynb");
        yield* writeTextFile(cwd, "demo.ipynb", notebookJson);

        const error = yield* notebooks
          .save({
            cwd,
            relativePath: absolutePath,
            baseRevision: "unused",
            cells: [],
          })
          .pipe(Effect.flip);

        expect(error._tag).toBe("NotebookSaveError");
        if (error._tag !== "NotebookSaveError") return;
        expect(error.failure).toBe("read_only_document");
      }),
    );

    it.effect("leaves no temp file behind after a successful save", () =>
      Effect.gen(function* () {
        const notebooks = yield* NotebookDocument.NotebookDocument;
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "demo.ipynb", notebookJson);
        const opened = yield* notebooks.open({ cwd, relativePath: "demo.ipynb" });

        yield* notebooks.save({
          cwd,
          relativePath: "demo.ipynb",
          baseRevision: opened.revision,
          cells: [
            {
              sessionId: "code-1",
              persistentId: "code-1",
              cellType: "code",
              source: "print(3)\n",
              metadata: {},
              outputs: "clear",
            },
          ],
        });

        const entries = yield* fileSystem.readDirectory(cwd);
        expect(entries.some((name) => name.includes(".t3-tmp-"))).toBe(false);
      }),
    );
  });
});
