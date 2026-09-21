import { NOTEBOOK_DOCUMENT_MAX_BYTES } from "@t3tools/contracts";
import { decodeFilePreviewText, FILE_TEXT_PREVIEW_MAX_BYTES } from "@t3tools/shared/filePreview";
import { notebookDocumentFromBytes, type NotebookDocumentResult } from "@t3tools/shared/notebook";

async function readBoundedBytes(
  response: Pick<Response, "ok" | "body">,
  signal: AbortSignal,
  maxBytes: number,
) {
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("The file could not be loaded. Reconnect and try again.");
  }
  if (signal.aborted) throw new Error("Preview cancelled.");
  const limit = maxBytes + 1;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming file previews are unavailable in this runtime.");
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      if (signal.aborted) throw new Error("Preview cancelled.");
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value.subarray(0, limit - length);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel();
  }
  if (signal.aborted) throw new Error("Preview cancelled.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated: bytes.byteLength > maxBytes };
}

/** Consume only a bounded prefix, even when a host ignores the requested HTTP range. */
export async function readFilePreviewResponse(
  response: Pick<Response, "ok" | "body">,
  signal: AbortSignal,
) {
  const { bytes } = await readBoundedBytes(response, signal, FILE_TEXT_PREVIEW_MAX_BYTES);
  return decodeFilePreviewText(bytes);
}

/** Read a complete notebook within the document budget. Truncated JSON is never parsed. */
export async function readNotebookPreviewDocument(
  response: Pick<Response, "ok" | "body">,
  signal: AbortSignal,
  file: { readonly relativePath: string; readonly cwd?: string },
): Promise<Exclude<NotebookDocumentResult, { _tag: "Failure" }>["document"]> {
  const { bytes, truncated } = await readBoundedBytes(
    response,
    signal,
    NOTEBOOK_DOCUMENT_MAX_BYTES,
  );
  if (truncated) {
    throw new Error(
      `This notebook is larger than ${NOTEBOOK_DOCUMENT_MAX_BYTES.toLocaleString()} bytes, so it cannot be opened without truncating it.`,
    );
  }
  const parsed = notebookDocumentFromBytes({
    cwd: file.cwd ?? "",
    relativePath: file.relativePath,
    bytes,
  });
  if (parsed._tag === "Failure") {
    if (parsed.failure === "document_too_large") {
      throw new Error(
        `This notebook is larger than ${NOTEBOOK_DOCUMENT_MAX_BYTES.toLocaleString()} bytes, so it cannot be opened without truncating it.`,
      );
    }
    if (parsed.failure === "binary_file") {
      throw new Error("This notebook contains binary data and cannot be opened.");
    }
    throw new Error("This notebook is not valid notebook JSON.");
  }
  return parsed.document;
}
