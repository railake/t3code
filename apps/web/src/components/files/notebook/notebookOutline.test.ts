import { describe, expect, it } from "vite-plus/test";

import {
  notebookCollapsedSessionIds,
  notebookMetadataWithSectionCollapsed,
  notebookOutlineFromCells,
  notebookSectionIsCollapsed,
} from "./notebookOutline";

describe("notebookOutlineFromCells", () => {
  it("collects markdown headings with levels", () => {
    expect(
      notebookOutlineFromCells([
        { sessionId: "a", cellType: "markdown", source: "# Title\n\nbody" },
        { sessionId: "b", cellType: "code", source: "print(1)" },
        { sessionId: "c", cellType: "markdown", source: "## Section" },
      ]),
    ).toEqual([
      { sessionId: "a", level: 1, text: "Title" },
      { sessionId: "c", level: 2, text: "Section" },
    ]);
  });
});

describe("notebookCollapsedSessionIds", () => {
  it("hides cells until the next equal-or-higher heading", () => {
    const cells = [
      {
        sessionId: "h1",
        cellType: "markdown" as const,
        source: "# One",
        metadata: { colab: { collapsed: true } },
      },
      {
        sessionId: "c1",
        cellType: "code" as const,
        source: "1",
        metadata: {},
      },
      {
        sessionId: "h2",
        cellType: "markdown" as const,
        source: "# Two",
        metadata: {},
      },
      {
        sessionId: "c2",
        cellType: "code" as const,
        source: "2",
        metadata: {},
      },
    ];
    expect([
      ...notebookCollapsedSessionIds({
        cells,
        localCollapsed: new Set(),
        persistColabMetadata: true,
      }),
    ]).toEqual(["c1"]);
  });

  it("honors local collapse when Colab metadata is not persisted", () => {
    const cells = [
      {
        sessionId: "h1",
        cellType: "markdown" as const,
        source: "# One",
        metadata: {},
      },
      {
        sessionId: "c1",
        cellType: "code" as const,
        source: "1",
        metadata: {},
      },
    ];
    expect([
      ...notebookCollapsedSessionIds({
        cells,
        localCollapsed: new Set(["h1"]),
        persistColabMetadata: false,
      }),
    ]).toEqual(["c1"]);
    expect(
      notebookSectionIsCollapsed({
        sessionId: "h1",
        metadata: {},
        localCollapsed: new Set(["h1"]),
        persistColabMetadata: false,
      }),
    ).toBe(true);
  });

  it("writes colab.collapsed without dropping sibling keys", () => {
    expect(
      notebookMetadataWithSectionCollapsed({ colab: { provenance: [] }, other: 1 }, true),
    ).toEqual({ colab: { provenance: [], collapsed: true }, other: 1 });
    expect(
      notebookMetadataWithSectionCollapsed({ colab: { collapsed: true, provenance: [] } }, false),
    ).toEqual({ colab: { collapsed: false, provenance: [] } });
  });
});
