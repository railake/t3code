# Notebooks

Open a `.ipynb` file from the file tree or an attachment preview. Web and desktop render cells with highlighted code, markdown (including KaTeX), and sandboxed HTML/SVG outputs. Mobile is read-only.

## Editing (web and desktop)

Workspace notebooks with nbformat 4 are editable. Attachments and absolute host paths stay read-only.

- Edit a cell with Enter (or double-click markdown). Esc returns to command mode.
- Toolbar: add code/text cells, clear all outputs, toggle outline, show raw JSON source.
- Heading cells show a chevron to collapse or expand the section below. If the notebook already has Colab metadata, collapse is saved on disk; otherwise it stays local to the session.
- Autosave debounces ~500ms; Cmd/Ctrl+S saves immediately. Pending edits keep the tab dirty indicator.
- If the file changes on disk while you have edits, use **Reload** or **Keep mine** — saves never silently overwrite.

### Keyboard shortcuts (notebook surface)

| Keys               | Mode    | Action                     |
| ------------------ | ------- | -------------------------- |
| Enter              | Command | Edit focused cell          |
| Esc                | Edit    | Command mode               |
| A / B              | Command | Insert cell above / below  |
| D D                | Command | Delete cell                |
| M / Y              | Command | Convert to markdown / code |
| Z / Shift+Z        | Command | Structural undo / redo     |
| Shift+M            | Command | Merge with cell below      |
| Cmd/Ctrl+Shift+-   | Edit    | Split cell at cursor       |
| Shift+Enter        | Either  | Focus next cell            |
| ↑ / ↓              | Command | Move focus                 |
| Cmd/Ctrl+Shift+↑/↓ | Either  | Move cell                  |
| Cmd/Ctrl+S         | Either  | Save now                   |

In-cell undo belongs to the text editor; cell insert/delete/move undo is separate.

## Colab forms

Code cells with `#@param` annotations show a form beside the source. `display-mode: "form"` or `metadata.cellView === "form"` hides code until you choose Show code. Changing a control rewrites the assignment line and saves like any other edit.

## Not supported

- Running cells (local kernels and Colab runtimes are out of scope).
- Interactive widgets and Plotly (static fallbacks only when present).
- Find/replace across cells.
