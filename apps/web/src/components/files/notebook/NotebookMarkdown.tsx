import type { EnvironmentId, NotebookCell, ScopedThreadRef } from "@t3tools/contracts";
import {
  normalizeNotebookMarkdownMath,
  rewriteNotebookMarkdownAttachments,
} from "@t3tools/shared/notebook";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "~/terminal-links";

const NOTEBOOK_REMARK_PLUGINS: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [remarkMath];
const NOTEBOOK_REHYPE_PLUGINS: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];

/** Images in a notebook resolve against the notebook's own folder, not the workspace root. */
export function notebookImageBaseDir(cwd: string, relativePath: string): string {
  const lastSeparator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  return lastSeparator >= 0
    ? resolvePathLinkTarget(relativePath.slice(0, lastSeparator), cwd)
    : cwd;
}

export function NotebookMarkdown(props: {
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
