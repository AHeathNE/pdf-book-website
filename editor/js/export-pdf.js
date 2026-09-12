import { renderPage } from '../../shared/renderer.js';
import { state } from './store.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

// html2canvas rasterizes a rotated element by mishandling its own CSS
// transform math — it comes out sheared, not cleanly rotated (confirmed
// against a real exported PDF). Real browsers rotate this content
// perfectly (the live editor/viewer use plain CSS transform, not
// html2canvas), so the fix is to never ask html2canvas to rotate
// anything itself: render each rotated object alone and unrotated into
// its own small canvas, then composite that onto the page with the
// browser's native, reliable Canvas 2D rotation instead.
async function renderRotatedObjectCanvas(obj) {
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = `${obj.w}px`;
  holder.style.height = `${obj.h}px`;
  document.body.appendChild(holder);
  try {
    const unrotated = { ...obj, x: 0, y: 0, rot: 0 };
    renderPage({ background: null, objects: [unrotated] }, holder, { editable: false });
    return await html2canvas(holder, {
      width: obj.w, height: obj.h, scale: 1, useCORS: true, backgroundColor: null,
    });
  } finally {
    holder.remove();
  }
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

  const offscreen = document.createElement('div');
  offscreen.style.position = 'fixed';
  offscreen.style.left = '-99999px';
  offscreen.style.top = '0';
  offscreen.style.width = `${widthPx}px`;
  offscreen.style.height = `${heightPx}px`;
  document.body.appendChild(offscreen);

  const { jsPDF } = window.jspdf;
  let doc = null;

  try {
    for (let i = 0; i < book.pages.length; i += 1) {
      setStatus(`Exporting PDF — page ${i + 1} of ${book.pages.length}…`);
      const pageData = book.pages[i];
      const rotatedObjects = pageData.objects.filter((o) => o.rot);
      const baseObjects = pageData.objects.filter((o) => !o.rot);

      renderPage({ ...pageData, objects: baseObjects }, offscreen, { editable: false });
      // eslint-disable-next-line no-await-in-loop
      const baseCanvas = await html2canvas(offscreen, { width: widthPx, height: heightPx, scale: 1, useCORS: true });

      // Drawing directly onto a canvas html2canvas handed back silently
      // does nothing further to it (reads back unchanged even right
      // after a plain fillRect, confirmed directly) — whatever it
      // returns isn't a normal mutable canvas. Copying it onto a fresh
      // canvas first sidesteps that entirely.
      const canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(baseCanvas, 0, 0);

      for (const obj of rotatedObjects) {
        // eslint-disable-next-line no-await-in-loop
        const objCanvas = await renderRotatedObjectCanvas(obj);
        ctx.save();
        ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
        ctx.rotate((obj.rot * Math.PI) / 180);
        ctx.drawImage(objCanvas, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
        ctx.restore();
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      if (!doc) doc = new jsPDF({ unit: 'pt', format: [wPt, hPt] });
      else doc.addPage([wPt, hPt]);
      doc.addImage(dataUrl, 'JPEG', 0, 0, wPt, hPt);
    }
    const name = (book.title || 'book').replace(/[^a-zA-Z0-9_.-]/g, '_');
    doc.save(`${name}.pdf`);
    setStatus('PDF exported.');
  } finally {
    offscreen.remove();
  }
}
