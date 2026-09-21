# Notebook save merge

Notebook opens strip widget state and unknown cell keys from the wire model. Clients therefore cannot round-trip a whole-file `projects.writeFile` without losing on-disk fidelity.

Saves go through `notebooks.save`: the client sends ordered cell edits plus `baseRevision` (sha256 of the bytes last opened or confirmed). The server re-reads the file, rejects a revision mismatch as `revision_conflict` ("changed on disk"), applies edits onto the **original JSON** (unknown keys, `metadata.widgets`, and non-cell top-level fields untouched), writes atomically via a sibling temp file, and returns the re-parsed document.

Serialization keeps the file's indent (Jupyter often uses 1 space; Colab often uses 2) and stores `source` as an array of lines with trailing newlines on every line except the last. Cell `id` values are generated only when `nbformat_minor >= 5`.

See `packages/shared/src/notebookEdits.ts` and `apps/server/src/notebook/NotebookDocument.ts`.
