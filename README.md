# PDF Book Website

A flipbook viewer and the no-build workstation that produces it. Everything
here is plain HTML/CSS/JS — no npm install, no bundler — so you can edit any
file directly and see the result.

```
shared/    data model + DOM renderer shared by both apps below
viewer/    the flipbook itself — the thing you publish to GitHub Pages
editor/    the workstation: a browser-based layout tool that builds the book
```

## Running it locally

Both apps load `book.json`/modules via `fetch`, which browsers block on
`file://` URLs, so serve the folder over plain HTTP instead of opening the
HTML files directly:

```bash
cd "PDF Book Website"
python3 serve.py 8000
```

Then open:
- `http://localhost:8000/viewer/index.html` — the sample flipbook
- `http://localhost:8000/editor/index.html` — the workstation

`serve.py` is a thin wrapper around `python3 -m http.server` that adds
`Cache-Control: no-store` and `Clear-Site-Data: "cache"` headers. Use it
instead of the bare `http.server` module while developing — plain
`http.server` lets the browser cache `.js` files by modification time,
which can silently serve a stale copy of a file you just edited until you
hard-refresh; that isn't a concern once a book is exported and published
(see below), just during local editing of this project's own source. Any
other static server works too (`npx serve`, VS Code's Live Server, etc.),
just make sure caching is off if you're actively editing the
editor/viewer source.

## Using the workstation (`editor/`)

- **Pages** (left panel): add/remove pages. **Front/back cover** checkboxes
  make page 1 and/or the last page sit alone (like a real book's covers)
  instead of pairing with a neighbor; the canvas otherwise always shows
  the current two-page spread. If a requested cover can't sit alone given
  the current page count, the canvas shows one auto-inserted blank page
  next to it (labeled as such) rather than silently ignoring the setting —
  add or remove a page to make it go away. Each page also has a **Table
  of Contents** field — give a page a label there and it gets an entry in
  the published book's Table of Contents (see below); leave it blank and
  the page has no entry.
- **Units**: page size and margins can be entered/displayed in inches,
  cm, or px. The conversion is based on the book's own **DPI** setting
  (default 150 — a print-quality assumption, not the old 96/72 screen
  default), so 1 inch = DPI px and 1 cm = DPI/2.54 px. Changing DPI is a
  pure resolution change — the book's physical size and layout proportions
  stay exactly the same; page size, margins, and every object's position/
  size/font size are rescaled together to compensate, so the PDF export
  (which is sized directly from px ÷ DPI) never silently changes size
  just because you bumped DPI up for a sharper export. Unit choice is just a
  display preference — it isn't saved with the project.
- **Book Setup**: page size (with an optional **lock ratio** checkbox so
  editing width scales height proportionally, and vice versa), margins
  (top/bottom/inner/outer — inner faces the spine and mirrors between
  left/right pages; check **same value for all margins** to edit all four
  together), a grid defined by **columns × rows** (not a fixed spacing) with
  its own **color** and whether it starts **on the page** (full bleed) or
  **between the margins**, and whether grid/margin snapping and the grid
  overlay are on.
- **Background**: the color/gradient/image shown behind the book itself
  (not the pages) when the site is published — now live-previewed behind
  the canvas in the editor too. An image background has a **Fit**
  option: Stretch (fills exactly, distorting), Fill (crops to fill,
  keeps aspect — the default), Fit (shows the whole image, may letterbox),
  or Repeat (tiles at its original size).
- **Palette** (above the canvas): add Text, Image, GIF, or Link objects to
  whichever page you last clicked into. Drag objects to move them (drag
  one across the boundary between two facing pages to move it onto the
  other page), drag a corner handle to resize — both snap to the grid and
  margin guides. Hold **Shift** while resizing to keep the object's aspect
  ratio for that drag, or check **Lock ratio** in Properties to keep it
  locked all the time. Rotation is set numerically in the Properties panel.
- **Properties** (right panel): edit the selected object's position, size,
  rotation, and type-specific fields (text/font/color, image source/alt/
  link, or link URL/label/colors). Restack it (front/back) here, and
  delete it either with the Delete button or by pressing **Delete** /
  **Backspace** with it selected.
- **Cut/copy/paste**: Ctrl+X / Ctrl+C / Ctrl+V (⌘ on Mac) on a selected
  object. Paste drops it at the exact position and size it was copied or
  cut from — on whichever page is currently active, including a different
  page than the one it came from. (Ctrl+P is the browser's print shortcut,
  so paste uses V, same as everywhere else.)
- **Import PDF**: rasterizes each page of an uploaded PDF as that page's
  locked background image (prioritizing looking exactly like the source
  PDF), replacing the current pages. Add text/link/GIF objects on top of
  the imported pages afterward like on any other page.
- **Undo/redo**: Ctrl+Z / Ctrl+Shift+Z (or the toolbar buttons). Each drag,
  resize, or field edit is one step.
- **Autosave**: your work is saved to the browser's IndexedDB as you go, so
  reloading the page restores it. This is local to one browser — use
  **Save Project** for a portable file.
- **Save Project / Open Project**: writes/reads a `.zip` (a `book.json`
  plus an `assets/` folder) that round-trips the whole project as a single
  file — for backing up work or moving it to another machine.
- **Export PDF**: renders the book to a PDF, one page at a time, sized
  from the page size + DPI set in Book Setup.
- **Export Website (.zip)**: packages the current book (as `viewer/` +
  your `book.json` + assets) into a zip. Unzip it and its `index.html` is
  the site — see below to publish it.

## Publishing a book to GitHub Pages

1. In the workstation, click **Export Website (.zip)** and unzip it.
2. Create a GitHub repository and commit the unzipped contents to its
   root (`index.html` should be at the repo root, not in a subfolder).
3. Push to GitHub.
4. In the repo, go to **Settings → Pages**, set Source to your default
   branch and folder `/ (root)`, and save.
5. The site publishes at `https://<user>.github.io/<repo>/` within a
   minute or two.

## Data model

Both apps share `shared/schema.js` (the `book.json` shape and factory
functions for pages/objects) and `shared/renderer.js` (turns one page's
data into DOM nodes — text/image/link elements, absolutely positioned).
The editor's canvas and the exported viewer both render pages through the
exact same function, so what you see while editing is what ships.

## Known limitations

- Object rotation is supported by the data model and renderer, but the
  editor's drag/resize handles don't account for rotation (rotate via the
  numeric field in Properties; move/resize before rotating for the least
  surprising handle behavior).
- Snapping targets the grid, margins, and page edges/center — not other
  objects.
- PDF import rasterizes pages (prioritizing visual fidelity); it does not
  extract the PDF's original text/vector content as editable objects.
