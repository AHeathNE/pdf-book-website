import { renderPage } from '../../shared/renderer.js';

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

// Renders one page through the exact same renderPage() used on-screen and
// rasterizes it at the page's native px size — shared by the PDF export and
// the dither filter (preview and exports), so all of them see the same
// pixels. Returns a plain, mutable canvas.
export async function rasterizePage(pageData, widthPx, heightPx) {
  const offscreen = document.createElement('div');
  offscreen.style.position = 'fixed';
  offscreen.style.left = '-99999px';
  offscreen.style.top = '0';
  offscreen.style.width = `${widthPx}px`;
  offscreen.style.height = `${heightPx}px`;
  document.body.appendChild(offscreen);

  try {
    const rotatedObjects = pageData.objects.filter((o) => o.rot);
    const baseObjects = pageData.objects.filter((o) => !o.rot);

    renderPage({ ...pageData, objects: baseObjects }, offscreen, { editable: false });
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
    return canvas;
  } finally {
    offscreen.remove();
  }
}
