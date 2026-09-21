import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eraser,
  EyeOff,
  Trash2,
  Type,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

import type { NotebookDraftCell } from "../notebookEditorReducer";
import { NotebookCodeEditor } from "./NotebookCodeEditor";
import { NotebookCodeSource } from "./NotebookCodeSource";
import { NotebookColabForm } from "./NotebookColabForm";
import { NotebookMarkdown } from "./NotebookMarkdown";
import { NotebookOutputs } from "./NotebookOutputs";
import { notebookHeadingLevel } from "./notebookOutline";

export const NotebookCellView = memo(function NotebookCellView(props: {
  readonly cell: NotebookDraftCell;
  readonly storeKey: string;
  readonly relativePath: string;
  readonly documentLanguage: string | undefined;
  readonly readOnly: boolean;
  readonly focused: boolean;
  readonly editing: boolean;
  readonly sectionCollapsed?: boolean;
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
  readonly onFocus: () => void;
  readonly onRequestEdit: () => void;
  readonly onSourceChange: (source: string) => void;
  readonly onToggleSectionCollapse?: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onConvert: () => void;
  readonly onClearOutputs: () => void;
  readonly onDelete: () => void;
}) {
  const [outputsCollapsed, setOutputsCollapsed] = useState(false);
  const language = props.cell.language ?? props.documentLanguage ?? "python";
  const isMarkdown = props.cell.cellType === "markdown";
  const headingLevel = isMarkdown ? notebookHeadingLevel(props.cell.source) : null;
  const editableType =
    props.cell.cellType === "code" ||
    props.cell.cellType === "markdown" ||
    props.cell.cellType === "raw";
  const showEditor = !props.readOnly && props.editing && editableType;

  const promptLabel =
    props.cell.cellType === "code"
      ? `In [${props.cell.executionCount ?? " "}]`
      : props.cell.cellType === "raw"
        ? "Raw"
        : props.cell.cellType === "unknown"
          ? "Unknown cell"
          : null;

  if (isMarkdown && !showEditor) {
    return (
      <li
        className={cn(
          "notebook-cell group relative rounded-md",
          props.focused && !props.readOnly ? "ring-2 ring-primary/50" : null,
        )}
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 8rem" }}
        data-notebook-session={props.cell.sessionId}
        onClick={props.onFocus}
        onDoubleClick={props.readOnly ? undefined : props.onRequestEdit}
      >
        {!props.readOnly ? (
          <CellHoverToolbar
            {...props}
            outputsCollapsed={outputsCollapsed}
            onToggleOutputs={() => setOutputsCollapsed((value) => !value)}
          />
        ) : null}
        <article className="flex min-w-0 gap-1 px-1 py-1">
          {headingLevel !== null && props.onToggleSectionCollapse ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.sectionCollapsed ? "Expand section" : "Collapse section"}
                    aria-expanded={!props.sectionCollapsed}
                    className="mt-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onToggleSectionCollapse?.();
                    }}
                  />
                }
              >
                {props.sectionCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {props.sectionCollapsed ? "Expand section" : "Collapse section"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <div className="min-w-0 flex-1">
            <NotebookMarkdown
              source={props.cell.source}
              attachments={props.cell.attachments}
              {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
              {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
              {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
              {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
            />
          </div>
        </article>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "notebook-cell group relative",
        props.focused && !props.readOnly ? "ring-2 ring-primary/50 rounded-md" : null,
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 8rem" }}
      data-notebook-session={props.cell.sessionId}
      onClick={props.onFocus}
    >
      {!props.readOnly ? (
        <CellHoverToolbar
          {...props}
          outputsCollapsed={outputsCollapsed}
          onToggleOutputs={() => setOutputsCollapsed((value) => !value)}
        />
      ) : null}
      <article className="min-w-0 rounded-md border border-border/60 bg-background">
        <div className="flex min-w-0 gap-2 px-2 py-2">
          {promptLabel !== null ? (
            <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-relaxed text-muted-foreground">
              {promptLabel}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            {props.cell.cellType === "code" ? (
              <NotebookColabForm
                source={props.cell.source}
                metadata={props.cell.metadata}
                readOnly={props.readOnly}
                onSourceChange={props.onSourceChange}
              >
                {showEditor && editableType ? (
                  <NotebookCodeEditor
                    storeKey={props.storeKey}
                    relativePath={props.relativePath}
                    sessionId={props.cell.sessionId}
                    cellType={props.cell.cellType}
                    language={language}
                    documentLanguage={props.documentLanguage}
                    source={props.cell.source}
                    onChange={props.onSourceChange}
                  />
                ) : (
                  <NotebookCodeSource code={props.cell.source} language={language} />
                )}
              </NotebookColabForm>
            ) : showEditor && editableType ? (
              <NotebookCodeEditor
                storeKey={props.storeKey}
                relativePath={props.relativePath}
                sessionId={props.cell.sessionId}
                cellType={props.cell.cellType}
                language={isMarkdown ? "markdown" : language}
                documentLanguage={props.documentLanguage}
                source={props.cell.source}
                onChange={props.onSourceChange}
              />
            ) : (
              <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-foreground">
                <code>{props.cell.source}</code>
              </pre>
            )}
          </div>
        </div>
        <NotebookOutputs
          sessionId={props.cell.sessionId}
          outputs={props.cell.outputs}
          executionCount={props.cell.executionCount}
          collapsed={outputsCollapsed}
          {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
          {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
          {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
          {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
        />
      </article>
    </li>
  );
});

function CellHoverToolbar(props: {
  readonly cell: NotebookDraftCell;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onConvert: () => void;
  readonly onClearOutputs: () => void;
  readonly onDelete: () => void;
  readonly outputsCollapsed: boolean;
  readonly onToggleOutputs: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-2 top-1 z-10 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
      <ToolbarIconButton label="Move up" onClick={() => props.onMove("up")}>
        <ArrowUp className="size-3.5" />
      </ToolbarIconButton>
      <ToolbarIconButton label="Move down" onClick={() => props.onMove("down")}>
        <ArrowDown className="size-3.5" />
      </ToolbarIconButton>
      {props.cell.cellType === "code" || props.cell.cellType === "markdown" ? (
        <ToolbarIconButton label="Convert" onClick={props.onConvert}>
          <Type className="size-3.5" />
        </ToolbarIconButton>
      ) : null}
      {props.cell.cellType === "code" ? (
        <>
          <ToolbarIconButton label="Clear outputs" onClick={props.onClearOutputs}>
            <Eraser className="size-3.5" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={props.outputsCollapsed ? "Show outputs" : "Collapse outputs"}
            onClick={props.onToggleOutputs}
          >
            <EyeOff className="size-3.5" />
          </ToolbarIconButton>
        </>
      ) : null}
      <ToolbarIconButton label="Delete" onClick={props.onDelete}>
        <Trash2 className="size-3.5" />
      </ToolbarIconButton>
    </div>
  );
}

function ToolbarIconButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            className="rounded border border-border/70 bg-background p-1 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              props.onClick();
            }}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
