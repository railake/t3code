import type {
  EnvironmentId,
  NotebookCell,
  NotebookDocument,
  NotebookMimePayload,
  ThreadId,
} from "@t3tools/contracts";
import {
  normalizeNotebookMarkdownMath,
  preferredNotebookDisplayPayloads,
  rewriteNotebookMarkdownAttachments,
  stripNotebookAnsi,
} from "@t3tools/shared/notebook";
import { useCallback, useMemo, useState } from "react";
import { Image, RefreshControl, ScrollView, View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";
import { FilePreviewNotice } from "./FilePreviewFeedback";
import { FileMarkdownPreview } from "./FileMarkdownPreview";

const NOTEBOOK_OUTPUT_STYLES =
  "html,body{margin:0;padding:8px;background:#fff;color:#111;font:13px/1.45 sans-serif}table{border-collapse:collapse}th,td{border:1px solid #d4d4d8;padding:.3em .65em;text-align:left}th{background:#f4f4f5}img,svg{max-width:100%;height:auto}";

export function NotebookPreview(props: {
  readonly document: NotebookDocument;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly onRefresh?: () => Promise<void> | void;
}) {
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handlePullToRefresh = useCallback(async () => {
    if (!props.onRefresh) return;
    setIsPullRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setIsPullRefreshing(false);
    }
  }, [props.onRefresh]);
  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerClassName="px-4 py-4"
      refreshControl={
        props.onRefresh ? (
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={() => void handlePullToRefresh()}
          />
        ) : undefined
      }
    >
      {props.document.warnings.map((warning) => (
        <FilePreviewNotice key={warning}>{warning}</FilePreviewNotice>
      ))}
      {props.document.cells.map((cell) => (
        <NotebookCellView
          key={cell.sessionId}
          cell={cell}
          cwd={props.cwd}
          environmentId={props.environmentId}
          threadId={props.threadId}
          relativePath={props.document.relativePath}
        />
      ))}
    </ScrollView>
  );
}

function NotebookCellView(props: {
  readonly cell: NotebookCell;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly relativePath: string;
}) {
  const label =
    props.cell.cellType === "code"
      ? `In [${props.cell.executionCount ?? " "}]`
      : props.cell.cellType === "markdown"
        ? null
        : props.cell.cellType === "raw"
          ? "Raw"
          : "Unknown cell";
  return (
    <View className="mb-4 overflow-hidden rounded-md border border-border bg-card">
      {label ? (
        <Text className="border-b border-border px-3 py-1.5 text-xs text-foreground-muted">
          {label}
          {props.cell.cellType === "code" && props.cell.language ? ` · ${props.cell.language}` : ""}
        </Text>
      ) : null}
      {props.cell.cellType === "markdown" ? (
        <NotebookMarkdown
          cwd={props.cwd}
          environmentId={props.environmentId}
          threadId={props.threadId}
          relativePath={props.relativePath}
          source={props.cell.source}
          attachments={props.cell.attachments}
        />
      ) : (
        <Text selectable className="px-3 py-3 font-mono text-sm text-foreground">
          {props.cell.source}
        </Text>
      )}
      {props.cell.outputs.map((output, outputIndex) => (
        <View
          key={`${props.cell.sessionId}:${outputIndex}`}
          className="border-t border-border px-3 py-2"
        >
          {output.outputType === "stream" ? (
            <Text
              selectable
              className={
                output.name === "stderr"
                  ? "font-mono text-xs text-destructive"
                  : "font-mono text-xs text-foreground"
              }
            >
              {stripNotebookAnsi(output.text)}
            </Text>
          ) : output.outputType === "error" ? (
            <Text selectable className="font-mono text-xs text-destructive">
              {output.ename}
              {output.evalue ? `: ${output.evalue}` : ""}
              {output.traceback.length > 0
                ? `\n${stripNotebookAnsi(output.traceback.join("\n"))}`
                : ""}
            </Text>
          ) : (
            preferredNotebookDisplayPayloads(output.payloads).map((payload, payloadIndex) => (
              <NotebookMimeView
                key={`${payload.kind}:${payload.mimeType}:${payloadIndex}`}
                payload={payload}
                cwd={props.cwd}
                environmentId={props.environmentId}
                threadId={props.threadId}
                relativePath={props.relativePath}
              />
            ))
          )}
        </View>
      ))}
    </View>
  );
}

function NotebookMarkdown(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly relativePath: string;
  readonly source: string;
  readonly attachments?: NotebookCell["attachments"];
}) {
  const markdown = useMemo(() => {
    const rewritten = rewriteNotebookMarkdownAttachments(props.source, props.attachments ?? []);
    const withMath = normalizeNotebookMarkdownMath(rewritten);
    return withMath.length > 0 ? withMath : " ";
  }, [props.attachments, props.source]);
  return (
    <FileMarkdownPreview
      cwd={props.cwd}
      environmentId={props.environmentId}
      markdown={markdown}
      relativePath={props.relativePath}
      threadId={props.threadId}
      embedded
    />
  );
}

function NotebookMimeView(props: {
  readonly payload: NotebookMimePayload;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly relativePath: string;
}) {
  if (props.payload.kind === "image") {
    return (
      <Image
        source={{ uri: props.payload.dataUrl }}
        accessibilityLabel="Notebook image output"
        className="max-h-96 w-full"
        resizeMode="contain"
      />
    );
  }
  if (props.payload.kind === "html" || props.payload.kind === "svg") {
    const body = props.payload.kind === "svg" ? props.payload.svg : props.payload.html;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${NOTEBOOK_OUTPUT_STYLES}</style></head><body>${body}</body></html>`;
    return (
      <WebView
        originWhitelist={["about:"]}
        javaScriptEnabled={false}
        source={{ html }}
        setSupportMultipleWindows={false}
        style={{ height: 240, backgroundColor: "transparent" }}
      />
    );
  }
  if (props.payload.kind === "markdown" || props.payload.kind === "latex") {
    return (
      <NotebookMarkdown
        cwd={props.cwd}
        environmentId={props.environmentId}
        threadId={props.threadId}
        relativePath={props.relativePath}
        source={
          props.payload.kind === "latex" ? `$$\n${props.payload.text}\n$$` : props.payload.text
        }
      />
    );
  }
  if (props.payload.kind === "unsupported") {
    return (
      <Text className="text-xs text-foreground-muted">
        {props.payload.mimeType} output is not rendered. It remains in the notebook file.
      </Text>
    );
  }
  return (
    <Text selectable className="font-mono text-xs text-foreground">
      {props.payload.text}
    </Text>
  );
}
