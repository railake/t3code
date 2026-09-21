/**
 * Reads the caret offset inside the focused notebook cell's Pierre editor.
 * Returns null when edit mode has no usable selection.
 */
export function readNotebookCellCaretOffset(): number | null {
  const wrap = document.querySelector("[data-notebook-cell-editor]");
  if (!(wrap instanceof HTMLElement)) return null;

  const host = wrap.querySelector("diffs-container");
  const root: ParentNode = host?.shadowRoot ?? wrap;
  const editable = root.querySelector('[contenteditable="true"]');
  if (!(editable instanceof HTMLElement)) return null;

  const selectionRoot = editable.getRootNode();
  const selection =
    selectionRoot instanceof ShadowRoot &&
    typeof (selectionRoot as ShadowRoot & { getSelection?: () => Selection | null })
      .getSelection === "function"
      ? (selectionRoot as ShadowRoot & { getSelection: () => Selection | null }).getSelection()
      : window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return null;

  const prefix = range.cloneRange();
  prefix.selectNodeContents(editable);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}
