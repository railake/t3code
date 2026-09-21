import { describe, expect, it } from "vite-plus/test";
import { NOTEBOOK_DOCUMENT_MAX_BYTES } from "@t3tools/contracts";

import {
  isNotebookPreviewFile,
  notebookAnsiSpans,
  notebookDocumentFromBytes,
  notebookSourceText,
  normalizeNotebookMarkdownMath,
  preferredNotebookDisplayPayloads,
  rewriteNotebookMarkdownAttachments,
  stripNotebookAnsi,
} from "./notebook.ts";

const encoder = new TextEncoder();

function bytesOf(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

function colabNotebook() {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      colab: { provenance: [], gpuType: "T4" },
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      widgets: { "application/vnd.jupyter.widget-state+json": { state: { keep: true } } },
      customKeep: { nested: [1, 2] },
    },
    cells: [
      {
        id: "md-1",
        cell_type: "markdown",
        source: ["# Title\n", "\n", "$$E = mc^2$$\n"],
        metadata: { colab: { collapsed: false } },
        attachments: { "plot.png": { "image/png": "aaa" } },
      },
      {
        id: "code-1",
        cell_type: "code",
        execution_count: 3,
        source: "print('hi')\n",
        metadata: {},
        outputs: [
          { output_type: "stream", name: "stdout", text: ["hi\n"] },
          {
            output_type: "execute_result",
            execution_count: 3,
            data: {
              "text/plain": ["42"],
              "text/html": ["<b>42</b>"],
              "image/png": "iVBORw0KGgo=",
              "application/json": { ok: true },
              "application/vnd.plotly.v1+json": { data: [] },
              "application/javascript": "alert(1)",
            },
            metadata: {},
          },
          {
            output_type: "error",
            ename: "ValueError",
            evalue: "nope",
            traceback: ["Traceback...", "ValueError: nope"],
          },
        ],
      },
      {
        cell_type: "raw",
        source: ["keep-raw"],
        metadata: { format: "text/plain" },
      },
      {
        cell_type: "future-widget",
        source: ["unknown"],
        metadata: { extra: 1 },
        mystery: true,
      },
    ],
  };
}

describe("notebook classification", () => {
  it("recognizes notebooks before generic JSON or text routing", () => {
    expect(isNotebookPreviewFile({ name: "analysis.ipynb" })).toBe(true);
    expect(isNotebookPreviewFile({ name: "analysis.IPYNB", mimeType: "text/plain" })).toBe(true);
    expect(isNotebookPreviewFile({ name: "analysis.ipynb", mimeType: "application/json" })).toBe(
      true,
    );
    expect(
      isNotebookPreviewFile({ name: "notes.json", mimeType: "application/x-ipynb+json" }),
    ).toBe(true);
    expect(isNotebookPreviewFile({ name: "analysis.json", mimeType: "application/json" })).toBe(
      false,
    );
  });
});

describe("notebookDocumentFromBytes", () => {
  it("normalizes a Colab notebook without mutating the source object or executing outputs", () => {
    const raw = colabNotebook();
    const frozen = structuredClone(raw);
    const result = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "notebooks/colab.ipynb",
      bytes: bytesOf(raw),
    });
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(raw).toEqual(frozen);
    expect(result.document.nbformat).toBe(4);
    expect(result.document.language).toBe("python");
    expect(result.document.readOnly).toBe(false);
    expect(result.document.capabilities.editing).toBe(true);
    expect(result.document.capabilities.colabExecution).toBe(false);
    expect(result.document.capabilities.colabExecutionUnavailableReason).toMatch(
      /allowlist|Google/i,
    );
    expect(result.document.cells).toHaveLength(4);
    expect(result.document.cells[0]).toMatchObject({
      persistentId: "md-1",
      cellType: "markdown",
      source: "# Title\n\n$$E = mc^2$$\n",
      hasAttachments: true,
      attachments: [
        {
          name: "plot.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aaa",
        },
      ],
    });
    expect(result.document.cells[1]?.executionCount).toBe(3);
    expect(result.document.cells[1]?.outputs[0]).toEqual({
      outputType: "stream",
      name: "stdout",
      text: "hi\n",
    });
    const display = result.document.cells[1]?.outputs[1];
    expect(display?.outputType).toBe("display");
    if (display?.outputType !== "display") return;
    expect(display.payloads.map((payload) => payload.kind).sort()).toEqual([
      "html",
      "image",
      "json",
      "text",
      "unsupported",
      "unsupported",
    ]);
    expect(
      display.payloads.some((payload) => payload.kind === "html" && payload.html === "<b>42</b>"),
    ).toBe(true);
    expect(
      display.payloads.some(
        (payload) =>
          payload.kind === "unsupported" && payload.mimeType === "application/javascript",
      ),
    ).toBe(true);
    expect(result.document.cells[2]).toMatchObject({
      persistentId: null,
      sessionId: "cell:2",
      cellType: "raw",
      source: "keep-raw",
    });
    expect(result.document.cells[3]).toMatchObject({
      cellType: "unknown",
      source: "unknown",
    });
    expect(result.document.metadata.customKeep).toEqual({ nested: [1, 2] });
    expect(result.document.metadata.colab).toEqual({ provenance: [], gpuType: "T4" });
    expect(result.document.metadata.widgets).toEqual({ present: true });
    expect(result.preserved.widgetState).toEqual({
      "application/vnd.jupyter.widget-state+json": { state: { keep: true } },
    });
    expect(result.preserved.unknownCellFields[3]).toEqual(["mystery"]);
    expect(
      result.document.warnings.some((warning) => /widget|unknown cell|future/i.test(warning)),
    ).toBe(true);
  });

  it("joins string-or-array sources and keeps missing IDs as stable session identities", () => {
    const result = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "old.ipynb",
      bytes: bytesOf({
        nbformat: 4,
        nbformat_minor: 2,
        metadata: {},
        cells: [
          { cell_type: "code", source: ["a = 1\n", "a"], metadata: {}, outputs: [] },
          { cell_type: "code", source: ["a = 1\n", "a"], metadata: {}, outputs: [] },
        ],
      }),
    });
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.document.cells.map((cell) => cell.sessionId)).toEqual(["cell:0", "cell:1"]);
    expect(result.document.cells[0]?.source).toBe("a = 1\na");
    expect(result.document.cells[0]?.sourceRevision).toBe(result.document.cells[1]?.sourceRevision);
    expect(result.document.cells[0]?.sessionId).not.toBe(result.document.cells[1]?.sessionId);
  });

  it("rejects invalid JSON, binary data, and files over the document budget without parsing", () => {
    expect(
      notebookDocumentFromBytes({
        cwd: "/repo",
        relativePath: "broken.ipynb",
        bytes: encoder.encode("{not json"),
      }),
    ).toMatchObject({ _tag: "Failure", failure: "invalid_notebook" });
    expect(
      notebookDocumentFromBytes({
        cwd: "/repo",
        relativePath: "binary.ipynb",
        bytes: new Uint8Array([123, 0, 125]),
      }),
    ).toMatchObject({ _tag: "Failure", failure: "binary_file" });
    const oversized = new Uint8Array(NOTEBOOK_DOCUMENT_MAX_BYTES + 1).fill(97);
    const tooLarge = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "huge.ipynb",
      bytes: oversized,
    });
    expect(tooLarge).toMatchObject({
      _tag: "Failure",
      failure: "document_too_large",
      byteLength: NOTEBOOK_DOCUMENT_MAX_BYTES + 1,
    });
  });

  it("does not treat a truncated JSON prefix as a notebook", () => {
    const full = JSON.stringify(colabNotebook());
    const truncated = encoder.encode(full.slice(0, 80));
    expect(
      notebookDocumentFromBytes({
        cwd: "/repo",
        relativePath: "cut.ipynb",
        bytes: truncated,
      }),
    ).toMatchObject({ _tag: "Failure", failure: "invalid_notebook" });
  });

  it("opens future nbformat read-only while keeping cell sources", () => {
    const result = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "future.ipynb",
      bytes: bytesOf({
        nbformat: 5,
        nbformat_minor: 0,
        metadata: {},
        cells: [{ cell_type: "markdown", source: "still here", metadata: {} }],
      }),
    });
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.document.readOnly).toBe(true);
    expect(result.document.capabilities.editing).toBe(false);
    expect(result.document.nbformat).toBe(5);
    expect(result.document.cells[0]?.source).toBe("still here");
    expect(result.document.warnings.some((warning) => /nbformat 5/i.test(warning))).toBe(true);
  });

  it("rejects objects that are not notebooks", () => {
    expect(
      notebookDocumentFromBytes({
        cwd: "/repo",
        relativePath: "notes.ipynb",
        bytes: bytesOf({ hello: "world" }),
      }),
    ).toMatchObject({ _tag: "Failure", failure: "invalid_notebook" });
  });
});

describe("notebookSourceText", () => {
  it("joins notebook source arrays without inserting extra newlines", () => {
    expect(notebookSourceText(["a\n", "b"])).toBe("a\nb");
    expect(notebookSourceText("plain")).toBe("plain");
  });
});

describe("preferredNotebookDisplayPayloads", () => {
  it("keeps HTML over plain text, and a static image over scripted HTML", () => {
    expect(
      preferredNotebookDisplayPayloads([
        { kind: "text", mimeType: "text/plain", text: "   a  b\n0  1  2" },
        { kind: "html", mimeType: "text/html", html: "<table><tr><td>1</td></tr></table>" },
      ]).map((payload) => payload.kind),
    ).toEqual(["html"]);
    expect(
      preferredNotebookDisplayPayloads([
        { kind: "html", mimeType: "text/html", html: "<div><script>window.Plotly</script></div>" },
        { kind: "image", mimeType: "image/png", dataUrl: "data:image/png;base64,aaa" },
        { kind: "unsupported", mimeType: "application/vnd.plotly.v1+json", byteLength: 12 },
        { kind: "text", mimeType: "text/plain", text: "Figure()" },
      ]).map((payload) => payload.kind),
    ).toEqual(["image"]);
  });

  it("falls through to text when scripted HTML has no image fallback", () => {
    expect(
      preferredNotebookDisplayPayloads([
        { kind: "html", mimeType: "text/html", html: "<script>alert(1)</script>" },
        { kind: "text", mimeType: "text/plain", text: "Figure()" },
      ]).map((payload) => payload.kind),
    ).toEqual(["text"]);
  });
});

describe("notebook markdown attachments and math", () => {
  it("rewrites attachment: links to data URLs and normalizes TeX delimiters", () => {
    expect(
      rewriteNotebookMarkdownAttachments("See ![plot](attachment:plot.png)", [
        { name: "plot.png", dataUrl: "data:image/png;base64,aaa" },
      ]),
    ).toBe("See ![plot](data:image/png;base64,aaa)");
    expect(normalizeNotebookMarkdownMath("Display \\[E=mc^2\\] and inline \\(a\\).")).toBe(
      "Display $$E=mc^2$$ and inline $a$.",
    );
  });

  it("classifies text/markdown outputs and prefers them over plain text", () => {
    const result = notebookDocumentFromBytes({
      cwd: "/repo",
      relativePath: "md.ipynb",
      bytes: bytesOf({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          {
            cell_type: "code",
            source: "",
            metadata: {},
            outputs: [
              {
                output_type: "display_data",
                data: {
                  "text/plain": "plain",
                  "text/markdown": "**bold**",
                },
                metadata: {},
              },
            ],
          },
        ],
      }),
    });
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    const display = result.document.cells[0]?.outputs[0];
    expect(display?.outputType).toBe("display");
    if (display?.outputType !== "display") return;
    expect(
      display.payloads.some(
        (payload) => payload.kind === "markdown" && payload.text === "**bold**",
      ),
    ).toBe(true);
    expect(
      preferredNotebookDisplayPayloads(display.payloads).map((payload) => payload.kind),
    ).toEqual(["markdown"]);
  });
});

describe("notebook ANSI", () => {
  it("strips control sequences and keeps color spans for SGR codes", () => {
    const colored = "\u001b[31mError\u001b[0m plain";
    expect(stripNotebookAnsi(colored)).toBe("Error plain");
    expect(notebookAnsiSpans(colored)).toEqual([
      { text: "Error", color: "#ef4444" },
      { text: " plain" },
    ]);
  });
});
