import { describe, expect, it } from "vite-plus/test";

import { notebookCellEditorCacheKey, notebookCellFileName } from "./notebookCellFile";

describe("notebookCellFileName", () => {
  it("names a cell after the language it highlights as", () => {
    expect(
      notebookCellFileName(
        "demo.ipynb",
        { cellType: "code", sessionId: "c1", language: undefined },
        "python",
      ),
    ).toBe("demo.ipynb/c1.py");
    expect(
      notebookCellFileName(
        "demo.ipynb",
        { cellType: "markdown", sessionId: "m1", language: undefined },
        "python",
      ),
    ).toBe("demo.ipynb/m1.md");
    expect(
      notebookCellFileName(
        "demo.ipynb",
        { cellType: "raw", sessionId: "r1", language: undefined },
        "python",
      ),
    ).toBe("demo.ipynb/r1.txt");
    expect(
      notebookCellFileName(
        "demo.ipynb",
        { cellType: "code", sessionId: "c2", language: "brand-new" },
        "python",
      ),
    ).toBe("demo.ipynb/c2.txt");
  });
});

describe("notebookCellEditorCacheKey", () => {
  it("keeps the attached editor's key while its text matches the draft", () => {
    const initial = notebookCellEditorCacheKey("env:/w:demo.ipynb", "c1", "print(1)", undefined);
    const whileTyping = notebookCellEditorCacheKey("env:/w:demo.ipynb", "c1", "print(12)", {
      cacheKey: initial,
      contents: "print(12)",
    });
    expect(whileTyping).toBe(initial);
  });

  it("mints a new key when the source did not come from the editor", () => {
    const initial = notebookCellEditorCacheKey("env:/w:demo.ipynb", "c1", "print(1)", undefined);
    const afterStructuralUndo = notebookCellEditorCacheKey("env:/w:demo.ipynb", "c1", "print(9)", {
      cacheKey: initial,
      contents: "print(1)",
    });
    expect(afterStructuralUndo).not.toBe(initial);
  });

  it("never adopts another cell's key", () => {
    const other = notebookCellEditorCacheKey("env:/w:demo.ipynb", "c2", "", undefined);
    expect(
      notebookCellEditorCacheKey("env:/w:demo.ipynb", "c1", "", { cacheKey: other, contents: "" }),
    ).not.toBe(other);
  });
});
