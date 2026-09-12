import { newPage } from '../../shared/schema.js';
import { state, commit, registerAsset } from './store.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

const IMPORT_DPI = 150;

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

function bookHasContent() {
  return state.book.pages.some((p) => p.background || p.objects.length > 0);
}

// Rasterizes each PDF page to a PNG (prioritizing visual fidelity over
// extracting editable text/vector content) and drops it in as that page's
// locked background image; the user can then layer text/links/gifs on top
// like on any other page. Replaces the current pages, since mixing a
// different aspect ratio into an existing hand-built layout isn't
// well-defined.
export async function importPdf(file) {
  if (bookHasContent()) {
    const ok = window.confirm('Importing a PDF replaces all current pages with the PDF\'s pages. Continue?');
    if (!ok) return;
  }

  setStatus(`Reading ${file.name}…`);
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const newPages = [];
  let widthPx = state.book.pageSize.widthPx;
  let heightPx = state.book.pageSize.heightPx;

  for (let i = 1; i <= pdf.numPages; i += 1) {
    setStatus(`Rendering page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: IMPORT_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    if (i === 1) { widthPx = canvas.width; heightPx = canvas.height; }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const url = registerAsset(blob, `pdf-page-${i}.png`);
    newPages.push(newPage({ background: { type: 'image', value: url } }));
  }

  commit((book) => {
    book.pages = newPages;
    book.pageSize = { widthPx, heightPx, dpi: IMPORT_DPI };
  });

  setStatus(`Imported ${newPages.length} page(s) from ${file.name}.`);
}
