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

// Draws one batch of consecutive unrotated objects onto a transparent
// layer, so it can be composited over what's already been drawn.
async function renderLayerCanvas(objects, widthPx, heightPx) {
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = `${widthPx}px`;
  holder.style.height = `${heightPx}px`;
  document.body.appendChild(holder);
  try {
    renderPage({ background: { type: 'color', value: 'transparent' }, objects }, holder, { editable: false });
    return await html2canvas(holder, {
      width: widthPx, height: heightPx, scale: 1, useCORS: true, backgroundColor: null,
    });
  } finally {
    holder.remove();
  }
}

// Renders one page through the exact same renderPage() used on-screen and
// rasterizes it at the page's native px size — shared by the PDF export and
// the dither filter (preview and exports), so all of them see the same
// pixels. Returns a plain, mutable canvas.
//
// Objects are composited in the same layer order the live page uses (see
// renderPage: by z, ties in list order). Rotated objects can't go through
// html2canvas along with the rest (see above), so they're separate layers —
// which is why this can't just draw every unrotated object first and every
// rotated one last: a rotated image would end up painted over text that
// sits above it.
export async function rasterizePage(pageData, widthPx, heightPx) {
  // Page background first, on its own, exactly as the live page paints it.
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = `${widthPx}px`;
  holder.style.height = `${heightPx}px`;
  document.body.appendChild(holder);

  let baseCanvas;
  try {
    renderPage({ ...pageData, objects: [] }, holder, { editable: false });
    baseCanvas = await html2canvas(holder, { width: widthPx, height: heightPx, scale: 1, useCORS: true });
  } finally {
    holder.remove();
  }

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

  const ordered = [...pageData.objects].sort((a, b) => (a.z || 1) - (b.z || 1)); // same key as the live z-index
  let run = [];
  const flushRun = async () => {
    if (!run.length) return;
    const layer = await renderLayerCanvas(run, widthPx, heightPx);
    ctx.drawImage(layer, 0, 0);
    run = [];
  };
  for (const obj of ordered) {
    if (!obj.rot) { run.push(obj); continue; }
    // eslint-disable-next-line no-await-in-loop
    await flushRun();
    // eslint-disable-next-line no-await-in-loop
    const objCanvas = await renderRotatedObjectCanvas(obj);
    ctx.save();
    ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
    ctx.rotate((obj.rot * Math.PI) / 180);
    ctx.drawImage(objCanvas, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
    ctx.restore();
  }
  await flushRun();
  return canvas;
}
