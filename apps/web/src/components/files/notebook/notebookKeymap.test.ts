import { describe, expect, it } from "vite-plus/test";

import { resolveNotebookKeymap } from "./notebookKeymap";

function event(
  key: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) {
  return {
    key,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  };
}

describe("resolveNotebookKeymap", () => {
  it("maps command-mode cell operations", () => {
    expect(resolveNotebookKeymap({ mode: "command", event: event("Enter") })).toEqual({
      type: "enter-edit",
    });
    expect(resolveNotebookKeymap({ mode: "command", event: event("a") })).toEqual({
      type: "insert-above",
    });
    expect(resolveNotebookKeymap({ mode: "command", event: event("b") })).toEqual({
      type: "insert-below",
    });
    expect(resolveNotebookKeymap({ mode: "command", event: event("d") })).toBeNull();
    expect(
      resolveNotebookKeymap({ mode: "command", event: event("d"), pendingDelete: true }),
    ).toEqual({ type: "delete-cell" });
    expect(resolveNotebookKeymap({ mode: "command", event: event("m") })).toEqual({
      type: "convert-markdown",
    });
    expect(resolveNotebookKeymap({ mode: "command", event: event("y") })).toEqual({
      type: "convert-code",
    });
  });

  it("maps edit-mode escapes and save", () => {
    expect(resolveNotebookKeymap({ mode: "edit", event: event("Escape") })).toEqual({
      type: "enter-command",
    });
    expect(resolveNotebookKeymap({ mode: "edit", event: event("a") })).toBeNull();
    expect(resolveNotebookKeymap({ mode: "edit", event: event("s", { metaKey: true }) })).toEqual({
      type: "save",
    });
    expect(
      resolveNotebookKeymap({
        mode: "edit",
        event: event("-", { metaKey: true, shiftKey: true }),
      }),
    ).toEqual({ type: "split-at-cursor" });
  });

  it("ignores keys when ignore is set", () => {
    expect(resolveNotebookKeymap({ mode: "command", event: event("a"), ignore: true })).toBeNull();
  });
});
