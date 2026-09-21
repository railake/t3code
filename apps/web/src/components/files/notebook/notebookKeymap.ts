export type NotebookKeymapMode = "command" | "edit";

export type NotebookKeymapAction =
  | { readonly type: "enter-edit" }
  | { readonly type: "enter-command" }
  | { readonly type: "insert-above" }
  | { readonly type: "insert-below" }
  | { readonly type: "delete-cell" }
  | { readonly type: "convert-markdown" }
  | { readonly type: "convert-code" }
  | { readonly type: "undo-structural" }
  | { readonly type: "redo-structural" }
  | { readonly type: "merge-below" }
  | { readonly type: "split-at-cursor" }
  | { readonly type: "save" }
  | { readonly type: "focus-prev" }
  | { readonly type: "focus-next" }
  | { readonly type: "move-cell-up" }
  | { readonly type: "move-cell-down" }
  | { readonly type: "run-focus-next" };

export type NotebookKeyEvent = {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
};

function isMod(event: NotebookKeyEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * Resolves Jupyter-style notebook shortcuts. Double-tap D is tracked by the
 * caller via `pendingDelete`; pass true on the second D within the window.
 */
export function resolveNotebookKeymap(input: {
  readonly mode: NotebookKeymapMode;
  readonly event: NotebookKeyEvent;
  readonly pendingDelete?: boolean;
  /** True when focus is in an input/textarea/contentEditable outside the cell editor. */
  readonly ignore?: boolean;
}): NotebookKeymapAction | null {
  if (input.ignore) return null;
  const { event, mode } = input;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (isMod(event) && !event.altKey && key === "s") {
    return { type: "save" };
  }

  if (isMod(event) && event.shiftKey && (key === "ArrowUp" || key === "Up")) {
    return { type: "move-cell-up" };
  }
  if (isMod(event) && event.shiftKey && (key === "ArrowDown" || key === "Down")) {
    return { type: "move-cell-down" };
  }

  if (mode === "edit") {
    if (key === "Escape") return { type: "enter-command" };
    if (event.shiftKey && key === "Enter") return { type: "run-focus-next" };
    if (isMod(event) && event.shiftKey && key === "-") return { type: "split-at-cursor" };
    return null;
  }

  // Command mode
  if (key === "Enter" && !event.shiftKey && !isMod(event)) return { type: "enter-edit" };
  if (event.shiftKey && key === "Enter") return { type: "run-focus-next" };
  if (key === "a" && !isMod(event) && !event.altKey) return { type: "insert-above" };
  if (key === "b" && !isMod(event) && !event.altKey) return { type: "insert-below" };
  if (key === "d" && !isMod(event) && !event.altKey) {
    return input.pendingDelete ? { type: "delete-cell" } : null;
  }
  if (key === "m" && !isMod(event) && !event.shiftKey) return { type: "convert-markdown" };
  if (key === "y" && !isMod(event)) return { type: "convert-code" };
  if (key === "z" && !isMod(event) && !event.shiftKey) return { type: "undo-structural" };
  if (key === "z" && !isMod(event) && event.shiftKey) return { type: "redo-structural" };
  if (key === "M" && event.shiftKey && !isMod(event)) return { type: "merge-below" };
  if (key === "ArrowUp" || key === "Up") return { type: "focus-prev" };
  if (key === "ArrowDown" || key === "Down") return { type: "focus-next" };
  return null;
}

export function isNotebookKeyIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable && !target.closest("[data-notebook-cell-editor]")) {
    return true;
  }
  return false;
}
