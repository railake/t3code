import { Suspense, use, useMemo } from "react";

import { HighlightedCodeLines } from "~/components/chat/HighlightedCodeLines";
import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";

/**
 * Static highlighted source for every cell that is not the focused one. Only
 * the focused cell pays for a live editor, so this has to stay cheap: shiki
 * renders it once per source change and nothing repaints afterwards.
 */
export function NotebookCodeSource(props: { readonly code: string; readonly language: string }) {
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
