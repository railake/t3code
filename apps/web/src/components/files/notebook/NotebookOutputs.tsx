import type {
  EnvironmentId,
  NotebookMimePayload,
  NotebookOutput,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { notebookAnsiSpans, preferredNotebookDisplayPayloads } from "@t3tools/shared/notebook";
import { lazy, memo, Suspense, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { FileSurfaceLoading } from "../fileSurfaceChrome";
import { NotebookMarkdown } from "./NotebookMarkdown";

const IsolatedRichOutput = lazy(async () => {
  const { IsolatedNotebookOutput } = await import("../IsolatedNotebookOutput.tsx");
  return { default: IsolatedNotebookOutput };
});

function NotebookAnsiText(props: { readonly text: string; readonly className?: string }) {
  const spans = notebookAnsiSpans(props.text);
  return (
    <pre className={props.className}>
      {spans.map((span, index) => {
        const style: CSSProperties = {
          ...(span.color === undefined ? {} : { color: span.color }),
          ...(span.fontWeight === undefined ? {} : { fontWeight: span.fontWeight }),
        };
        return (
          // oxlint-disable-next-line react/no-array-index-key
          <span key={index} style={style}>
            {span.text}
          </span>
        );
      })}
    </pre>
  );
}

function NotebookMimeView(props: {
  readonly payload: NotebookMimePayload;
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}): ReactNode {
  if (props.payload.kind === "image") {
    return (
      <img src={props.payload.dataUrl} alt="" className="max-h-[32rem] max-w-full object-contain" />
    );
  }
  if (props.payload.kind === "svg") {
    return (
      <Suspense fallback={<FileSurfaceLoading className="h-32" />}>
        <IsolatedRichOutput
          kind="svg"
          markup={props.payload.svg}
          title={`${props.payload.mimeType} output`}
        />
      </Suspense>
    );
  }
  if (props.payload.kind === "html") {
    return (
      <Suspense fallback={<FileSurfaceLoading className="h-32" />}>
        <IsolatedRichOutput
          kind="html"
          markup={props.payload.html}
          title={`${props.payload.mimeType} output`}
        />
      </Suspense>
    );
  }
  if (props.payload.kind === "markdown") {
    return (
      <NotebookMarkdown
        source={props.payload.text}
        {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
        {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
        {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
        {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
      />
    );
  }
  if (props.payload.kind === "latex") {
    return (
      <NotebookMarkdown
        source={`$$\n${props.payload.text}\n$$`}
        {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
        {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
        {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
        {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
      />
    );
  }
  if (props.payload.kind === "json" || props.payload.kind === "text") {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/80">
        {props.payload.text}
      </pre>
    );
  }
  return (
    <p className="text-[12px] text-muted-foreground">
      {props.payload.mimeType} output is not rendered ({props.payload.byteLength.toLocaleString()}{" "}
      bytes). It remains in the notebook file.
    </p>
  );
}

export const NotebookOutputView = memo(function NotebookOutputView(props: {
  readonly output: NotebookOutput;
  readonly executionCount: number | null;
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}) {
  if (props.output.outputType === "stream") {
    return (
      <NotebookAnsiText
        text={props.output.text}
        className={cn(
          "overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed",
          props.output.name === "stderr" ? "text-destructive" : "text-foreground/80",
        )}
      />
    );
  }
  if (props.output.outputType === "error") {
    return (
      <div className="rounded-sm bg-destructive/10 px-2 py-2 text-[12px] text-destructive">
        <p className="font-medium">
          {props.output.ename}
          {props.output.evalue ? `: ${props.output.evalue}` : ""}
        </p>
        {props.output.traceback.length > 0 ? (
          <NotebookAnsiText
            text={props.output.traceback.join("\n")}
            className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-foreground"
          />
        ) : null}
      </div>
    );
  }
  const payloads = preferredNotebookDisplayPayloads(props.output.payloads);
  return (
    <div className="flex min-w-0 gap-2">
      <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-relaxed text-muted-foreground">
        {props.executionCount !== null ? `Out [${props.executionCount}]` : "Out"}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {payloads.map((payload, index) => (
          <NotebookMimeView
            key={`${payload.kind}:${payload.mimeType}:${index}`}
            payload={payload}
            {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
            {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
            {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
            {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
          />
        ))}
      </div>
    </div>
  );
});

export const NotebookOutputs = memo(function NotebookOutputs(props: {
  readonly sessionId: string;
  readonly outputs: ReadonlyArray<NotebookOutput>;
  readonly executionCount: number | null;
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
  readonly collapsed?: boolean;
}) {
  if (props.collapsed || props.outputs.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border/50 px-2 py-2">
      {props.outputs.map((output, outputIndex) => (
        <NotebookOutputView
          key={`${props.sessionId}:${outputIndex}`}
          executionCount={props.executionCount}
          output={output}
          {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
          {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
          {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
          {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
        />
      ))}
    </div>
  );
});
