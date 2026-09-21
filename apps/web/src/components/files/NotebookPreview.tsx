import type {
  EnvironmentId,
  NotebookCell,
  NotebookDocument,
  NotebookMimePayload,
  NotebookOutput,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  normalizeNotebookMarkdownMath,
  notebookAnsiSpans,
  preferredNotebookDisplayPayloads,
  rewriteNotebookMarkdownAttachments,
} from "@t3tools/shared/notebook";
import "katex/dist/katex.min.css";
import { lazy, Suspense, use, useMemo, type CSSProperties, type ReactNode } from "react";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import ChatMarkdown from "~/components/ChatMarkdown";
import { HighlightedCodeLines } from "~/components/chat/HighlightedCodeLines";
import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { FileSurfaceLoading, FileSurfaceNotice } from "./fileSurfaceChrome";

const IsolatedRichOutput = lazy(async () => {
  const { IsolatedNotebookOutput } = await import("./IsolatedNotebookOutput.tsx");
  return { default: IsolatedNotebookOutput };
});

const NOTEBOOK_REMARK_PLUGINS: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [remarkMath];
const NOTEBOOK_REHYPE_PLUGINS: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];

export function NotebookPreview(props: {
  readonly document: NotebookDocument;
  readonly cwd?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}) {
  const imageBaseDir =
    props.cwd === undefined
      ? undefined
      : notebookImageBaseDir(props.cwd, props.document.relativePath);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {props.document.warnings.map((warning) => (
        <FileSurfaceNotice key={warning}>{warning}</FileSurfaceNotice>
      ))}
      <ol className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-5">
        {props.document.cells.map((cell) => (
          <li
            key={cell.sessionId}
            className="notebook-cell"
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 8rem" }}
          >
            <NotebookCellView
              cell={cell}
              {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
              {...(imageBaseDir === undefined ? {} : { imageBaseDir })}
              {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
              {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function notebookImageBaseDir(cwd: string, relativePath: string): string {
  const lastSeparator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  return lastSeparator >= 0
    ? resolvePathLinkTarget(relativePath.slice(0, lastSeparator), cwd)
    : cwd;
}

function NotebookCellView(props: {
  readonly cell: NotebookCell;
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}) {
  const language = props.cell.language ?? "python";
  if (props.cell.cellType === "markdown") {
    return (
      <article className="min-w-0 px-1 py-1">
        <NotebookMarkdown
          source={props.cell.source}
          attachments={props.cell.attachments}
          {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
          {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
          {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
          {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
        />
      </article>
    );
  }

  const promptLabel =
    props.cell.cellType === "code"
      ? `In [${props.cell.executionCount ?? " "}]`
      : props.cell.cellType === "raw"
        ? "Raw"
        : "Unknown cell";

  return (
    <article className="min-w-0 rounded-md border border-border/60 bg-background">
      <div className="flex min-w-0 gap-2 px-2 py-2">
        <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] leading-relaxed text-muted-foreground">
          {promptLabel}
        </div>
        <div className="min-w-0 flex-1">
          {props.cell.cellType === "code" ? (
            <NotebookCodeSource code={props.cell.source} language={language} />
          ) : (
            <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-foreground">
              <code>{props.cell.source}</code>
            </pre>
          )}
        </div>
      </div>
      {props.cell.outputs.length > 0 ? (
        <div className="space-y-2 border-t border-border/50 px-2 py-2">
          {props.cell.outputs.map((output, outputIndex) => (
            <NotebookOutputView
              key={`${props.cell.sessionId}:${outputIndex}`}
              executionCount={props.cell.executionCount}
              output={output}
              {...(props.cwd === undefined ? {} : { cwd: props.cwd })}
              {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
              {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
              {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function NotebookMarkdown(props: {
  readonly source: string;
  readonly attachments?: NotebookCell["attachments"];
  readonly cwd?: string;
  readonly imageBaseDir?: string;
  readonly threadRef?: ScopedThreadRef;
  readonly environmentId?: EnvironmentId;
}) {
  const text = useMemo(() => {
    const withAttachments = rewriteNotebookMarkdownAttachments(
      props.source,
      props.attachments ?? [],
    );
    const withMath = normalizeNotebookMarkdownMath(withAttachments);
    return withMath.length > 0 ? withMath : " ";
  }, [props.attachments, props.source]);
  return (
    <ChatMarkdown
      text={text}
      cwd={props.cwd}
      {...(props.imageBaseDir === undefined ? {} : { imageBaseDir: props.imageBaseDir })}
      {...(props.threadRef === undefined ? {} : { threadRef: props.threadRef })}
      {...(props.environmentId === undefined ? {} : { environmentId: props.environmentId })}
      extraRemarkPlugins={NOTEBOOK_REMARK_PLUGINS}
      extraRehypePlugins={NOTEBOOK_REHYPE_PLUGINS}
      className="max-w-none px-0 py-0"
    />
  );
}

function NotebookCodeSource(props: { readonly code: string; readonly language: string }) {
  return (
    <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-foreground">
      <RenderErrorBoundary fallback={<code>{props.code}</code>}>
        <Suspense fallback={<code>{props.code}</code>}>
          <HighlightedNotebookCode code={props.code} language={props.language} />
        </Suspense>
      </RenderErrorBoundary>
    </pre>
  );
}

function HighlightedNotebookCode(props: { readonly code: string; readonly language: string }) {
  const { resolvedTheme } = useTheme();
  const highlighter = use(getSyntaxHighlighterPromise(props.language));
  const themeName = resolveDiffThemeName(resolvedTheme);
  const highlighted = useMemo(() => {
    try {
      return highlighter.codeToHast(props.code, { lang: props.language, theme: themeName });
    } catch {
      return highlighter.codeToHast(props.code, { lang: "text", theme: themeName });
    }
  }, [highlighter, props.code, props.language, themeName]);
  return (
    <div className="notebook-shiki [&_code]:bg-transparent [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-0">
      <HighlightedCodeLines root={highlighted} />
    </div>
  );
}

function NotebookOutputView(props: {
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
          // Color runs are positional; the traceback text is static per output.
          // oxlint-disable-next-line react/no-array-index-key
          <span key={index} style={style}>
            {span.text}
          </span>
        );
      })}
    </pre>
  );
}
