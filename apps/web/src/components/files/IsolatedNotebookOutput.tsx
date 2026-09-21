/**
 * HTML and SVG notebook outputs render in an opaque-origin frame with no
 * scripts, forms, or credentialed access to the app.
 */
const NOTEBOOK_OUTPUT_STYLES = [
  "html,body{margin:0;padding:8px;background:#fff;color:#111;",
  "font:13px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}",
  "table{border-collapse:collapse;border-spacing:0}",
  "th,td{border:1px solid #d4d4d8;padding:.3em .65em;text-align:left;vertical-align:top}",
  "th{background:#f4f4f5;font-weight:600}",
  "thead th{background:#f4f4f5}",
  "img,svg{max-width:100%;height:auto}",
  "pre{white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}",
].join("");

export function IsolatedNotebookOutput(props: {
  readonly kind: "html" | "svg";
  readonly markup: string;
  readonly title: string;
}) {
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>${NOTEBOOK_OUTPUT_STYLES}</style></head><body>${props.markup}</body></html>`;
  return (
    <iframe
      title={props.title}
      srcDoc={srcDoc}
      sandbox=""
      referrerPolicy="no-referrer"
      className={
        props.kind === "svg"
          ? "min-h-24 w-full border border-border/40 bg-white"
          : "min-h-32 max-h-[40rem] w-full border border-border/40 bg-white"
      }
    />
  );
}
