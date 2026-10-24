import { state } from './store.js';
import { rasterizePage } from './rasterize.js';
import { ditherToDots, upscaleDots } from './dither.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

// Renders each page through the exact same renderPage() used on-screen,
// rasterizes it with html2canvas, and drops it into a jsPDF page sized
// from the book's pageSize/dpi — so the PDF matches the live editor
// preview pixel-for-pixel rather than being reconstructed independently.
export async function exportPdf() {
  const book = state.book;
  const { widthPx, heightPx, dpi } = book.pageSize;
  const wPt = (widthPx * 72) / dpi;
  const hPt = (heightPx * 72) / dpi;
  // jsPDF defaults to portrait and silently swaps a wider-than-tall
  // `format` array to match, regardless of the array's own order — never
  // noticed before since every book was portrait-shaped anyway, but a
  // landscape page (e.g. a vertical/top-bottom book) needs this spelled
  // out explicitly or every page comes out rotated 90deg from the editor.
  const orientation = wPt >= hPt ? 'landscape' : 'portrait';

  const { jsPDF } = window.jspdf;
  let doc = null;

  for (let i = 0; i < book.pages.length; i += 1) {
    setStatus(`Exporting PDF — page ${i + 1} of ${book.pages.length}…`);
    // eslint-disable-next-line no-await-in-loop
    let canvas = await rasterizePage(book.pages[i], widthPx, heightPx);

    // A dithered page is two flat colors, so it goes in as lossless PNG
    // (JPEG would smear every dot) and each dot is blown back up to a crisp
    // square at the page's native size first.
    if (book.dither.enabled) canvas = upscaleDots(ditherToDots(canvas, book.dither), widthPx, heightPx);

    if (!doc) doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation });
    else doc.addPage([wPt, hPt], orientation);
    if (book.dither.enabled) doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, wPt, hPt, undefined, 'FAST');
    else doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wPt, hPt);
  }
  const name = (book.title || 'book').replace(/[^a-zA-Z0-9_.-]/g, '_');
  doc.save(`${name}.pdf`);
  setStatus('PDF exported.');
}
