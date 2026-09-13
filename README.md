# PDF Book Website

A flipbook viewer and the no-build workstation that produces it. Everything
here is plain HTML/CSS/JS — no npm install, no bundler — so you can edit any
file directly and see the result.

## Live demo

- **[Landing page](https://aheathne.github.io/pdf-book-website/)**
- **[Sample flipbook](https://aheathne.github.io/pdf-book-website/viewer/index.html)** — the published viewer
- **[Workstation / editor](https://aheathne.github.io/pdf-book-website/editor/index.html)** — build your own book
- **[Booklet size comparison](https://aheathne.github.io/pdf-book-website/examples/size-comparison.html)** — how the four page-size presets scale, horizontal and vertical

```
shared/    data model + DOM renderer shared by both apps below
viewer/    the flipbook itself — the thing you publish to GitHub Pages
editor/    the workstation: a browser-based layout tool that builds the book
desktop/   optional Electron wrapper — see "Desktop app" below
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

## Desktop app (Electron)

The workstation can also run as a native window instead of a browser tab —
same app, unchanged, just wrapped. This is the only part of the project
that needs Node/npm; the web app itself (`editor/`, `viewer/`, `shared/`)
still has no build step and works exactly as described above regardless.

```bash
npm install   # pulls in Electron itself — a one-time few-hundred-MB download
npm start
```

That opens straight into the workstation in its own window. Under the
hood, `desktop/main.js` starts the same kind of local static server as
`serve.py` (`desktop/server.js`, on a fixed port so IndexedDB autosave and
your saved preferences persist across launches) and points an Electron
window at it — the app still can't be opened via a bare `file://` double
click, for the same ES-module/`fetch()` reasons as running it in a browser.

Exports (PDF, website zip, standalone HTML, Save Project) land in your
normal OS Downloads folder, same as they would from a browser tab.

To build an installable package for this machine:

```bash
npm run dist:linux   # produces an AppImage and a .deb in dist/
```

The `build` config in `package.json` is written to be platform-agnostic —
building for Windows/Mac from a machine running that OS is just
`electron-builder --win` / `--mac` with no code changes, though this
hasn't been tried yet.

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
  editing width scales height proportionally, and vice versa, and a swap
  button between the two fields to flip a page between portrait and
  landscape without retyping either number), margins (top/bottom/inner/
  outer — inner faces the spine and mirrors between facing pages; check
  **same value for all margins** to edit all four together), a grid
  defined by **columns × rows** (not a fixed spacing) with its own
  **color** and whether it starts **on the page** (full bleed) or
  **between the margins**, and whether grid/margin snapping and the grid
  overlay are on.
- **Page layout**: **Horizontal** (the default — pages pair left/right
  like a normal book) or **Vertical** (pages pair top/bottom instead — a
  landscape page stacked on another landscape page). Margins reinterpret
  accordingly: inner/outer always follows whichever axis pages actually
  face each other across, so in vertical layout the top/bottom margin
  fields become the fixed left/right margins instead. Since the flip
  library itself only ever turns pages left/right, a vertical book is
  rendered as a normal one rotated 90° with each page's content
  counter-rotated to stay upright — the published site's corner-drag/
  click turning still works the same way, it just reads as up/down.
- **Zoom** (bottom-right of the canvas): zooms the editing view only —
  independent of the book's actual size/DPI — from 25% up to 300%, with
  a **Fit** button to reset. The published viewer has its own zoom
  control too (top-right of the book, 100%–300% since "fit" is already
  a reader's natural starting point), for getting a closer look at a
  page; the book scrolls/pans while zoomed in.
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
- **Export Standalone HTML**: everything — the viewer, the book data, and
  every image/GIF (as embedded `data:` URIs) — bundled into one `.html`
  file. Nothing to unzip, publish, or serve: double-click it, or attach
  it to an email, and it opens straight into the working flipbook in any
  browser. Trades that convenience for file size, since embedding images
  this way runs about a third larger than the same files would be on
  their own — a good fit for text/photo booklets, less so for anything
  image-heavy (use Export Website for those instead).

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
