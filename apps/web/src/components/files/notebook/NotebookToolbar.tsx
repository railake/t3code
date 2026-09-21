import { cn } from "~/lib/utils";

import {
  notebookCellCountLabel,
  notebookSaveStatusLabel,
  type NotebookSaveStatus,
} from "./notebookToolbarState";

export function NotebookToolbar(props: {
  readonly readOnly: boolean;
  readonly cellCount: number;
  readonly saveStatus: NotebookSaveStatus;
  readonly onAddCode: () => void;
  readonly onAddText: () => void;
  readonly onClearAllOutputs: () => void;
  readonly onReload?: () => void;
  readonly onKeepMine?: () => void;
  readonly showSource: boolean;
  readonly onToggleSource: () => void;
  readonly outlineOpen?: boolean;
  readonly onToggleOutline?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 text-[12px]">
      {!props.readOnly ? (
        <>
          <button
            type="button"
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
            onClick={props.onAddCode}
          >
            + Code
          </button>
          <button
            type="button"
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
            onClick={props.onAddText}
          >
            + Text
          </button>
          <button
            type="button"
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
            onClick={props.onClearAllOutputs}
          >
            Clear all outputs
          </button>
        </>
      ) : null}
      {props.onToggleOutline ? (
        <button
          type="button"
          className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
          onClick={props.onToggleOutline}
        >
          {props.outlineOpen ? "Hide outline" : "Outline"}
        </button>
      ) : null}
      <button
        type="button"
        className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
        onClick={props.onToggleSource}
      >
        {props.showSource ? "Show notebook" : "Show notebook source"}
      </button>
      <span className="text-muted-foreground">{notebookCellCountLabel(props.cellCount)}</span>
      <span
        className={cn(
          "ml-auto",
          props.saveStatus === "disk-changed"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {notebookSaveStatusLabel(props.saveStatus)}
      </span>
      {props.saveStatus === "disk-changed" ? (
        <span className="flex gap-1">
          <button
            type="button"
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
            onClick={props.onReload}
          >
            Reload
          </button>
          <button
            type="button"
            className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted/60"
            onClick={props.onKeepMine}
          >
            Keep mine
          </button>
        </span>
      ) : null}
    </div>
  );
}
