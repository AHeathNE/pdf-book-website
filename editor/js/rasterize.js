import { renderPage } from '../../shared/renderer.js';

// Rasterizes one page at its native px size, through the exact same
// renderPage() the editor and viewer use — shared by the PDF export and the
// dither filter (preview and exports), so all of them see the same pixels.
//
// Speed matters here (the dither preview rebuilds after every edit), and the
// cost is almost entirely per html2canvas call — about 150 ms each whatever
// the size, even for an empty page — so the whole design is to make as few
// calls as the layer order allows:
//   1. the page background plus every object that doesn't need to go later;
//   2. every rotated object together, laid out on one transparent sheet;
//   3. only if some unrotated object sits above a rotated one, those last.
// Pages where that plan can't keep the order correct fall back to
// rasterizeSequentially(), which composites one layer at a time.

// How many px tall one sheet of rotated objects may get (canvas size limits).
const MAX_SHEET_HEIGHT = 4000;

const TRANSPARENT = { type: 'color', value: 'transparent' };

// Renders `pageLike` into an offscreen holder and captures it. html2canvas
// would otherwise copy the entire editor interface along with the holder on
// every call, so that's skipped. `transparent` leaves the canvas see-through
// instead of white, for layers that get composited over something.
async function capture(pageLike, widthPx, heightPx, transparent) {
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = `${widthPx}px`;
  holder.style.height = `${heightPx}px`;
  document.body.appendChild(holder);
  try {
    renderPage(pageLike, holder, { editable: false });
    const options = {
      width: widthPx, height: heightPx, scale: 1, useCORS: true, ignoreElements: (el) => el.id === 'app',
    };
    if (transparent) options.backgroundColor = null;
    return await html2canvas(holder, options);
  } finally {
    holder.remove();
  }
}

// Copies a captured canvas onto a fresh one that layers can be drawn on.
//
// html2canvas rasterizes a rotated element by mishandling its own CSS
// transform math — it comes out sheared, not cleanly rotated (confirmed
// against a real exported PDF) — so it's never asked to rotate anything:
// rotated objects are captured upright and rotated here with the browser's
// native Canvas 2D instead. And drawing directly onto a canvas html2canvas
// handed back silently does nothing (reads back unchanged even right after a
// plain fillRect, confirmed directly), so its output is copied onto a plain
// canvas before anything is composited on it.
function newCanvasFrom(source, widthPx, heightPx) {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

function drawRotated(ctx, obj, source, sx, sy) {
  ctx.save();
  ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
  ctx.rotate((obj.rot * Math.PI) / 180);
  ctx.drawImage(source, sx, sy, obj.w, obj.h, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
  ctx.restore();
}

// Objects in the live page's stacking order: by z (same key as the CSS
// z-index renderPage sets), ties in list order.
function stackingOrder(pageData) {
  return [...pageData.objects].sort((a, b) => (a.z || 1) - (b.z || 1));
}

// One layer at a time, in true stacking order: runs of unrotated objects go
// through together, each rotated object on its own. Always correct, but one
// call per run/rotated object.
async function rasterizeSequentially(pageData, ordered, widthPx, heightPx) {
  const canvas = newCanvasFrom(await capture({ ...pageData, objects: [] }, widthPx, heightPx, false), widthPx, heightPx);
  const ctx = canvas.getContext('2d');

  let run = [];
  const flushRun = async () => {
    if (!run.length) return;
    ctx.drawImage(await capture({ background: TRANSPARENT, objects: run }, widthPx, heightPx, true), 0, 0);
    run = [];
  };
  for (const obj of ordered) {
    if (!obj.rot) { run.push(obj); continue; }
    // eslint-disable-next-line no-await-in-loop
    await flushRun();
    // A null background would mean white to renderPage, painting an opaque
    // box behind a rotated image's transparent areas over whatever is
    // beneath it — so it asks for a transparent one explicitly.
    // eslint-disable-next-line no-await-in-loop
    const upright = await capture({ background: TRANSPARENT, objects: [{ ...obj, x: 0, y: 0, rot: 0 }] }, obj.w, obj.h, true);
    drawRotated(ctx, obj, upright, 0, 0);
  }
  await flushRun();
  return canvas;
}

// Smallest axis-aligned box around an object, rotation included.
function boundsOf(obj) {
  const cx = obj.x + obj.w / 2;
  const cy = obj.y + obj.h / 2;
  const angle = ((obj.rot || 0) * Math.PI) / 180;
  const halfW = (Math.abs(obj.w * Math.cos(angle)) + Math.abs(obj.h * Math.sin(angle))) / 2;
  const halfH = (Math.abs(obj.w * Math.sin(angle)) + Math.abs(obj.h * Math.cos(angle))) / 2;
  return {
    left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH,
  };
}

function overlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// Which unrotated objects must be drawn after the rotated ones, or null if
// the plan can't keep the stacking order (see the header). An unrotated
// object has to come later when a rotated one it overlaps is beneath it —
// and so does anything above that one that overlaps it, since a later layer
// can't go under an earlier one. Overlap is judged by bounding boxes, which
// can only make it more cautious than strictly necessary, never wrong.
function planLateObjects(ordered, rotated, bounds) {
  const index = new Map(ordered.map((obj, i) => [obj, i]));
  const late = [];
  for (const obj of ordered) {
    if (obj.rot) continue;
    const beneath = (other) => index.get(other) < index.get(obj) && overlap(bounds.get(other), bounds.get(obj));
    if (rotated.some(beneath) || late.some(beneath)) late.push(obj);
  }
  // A late object is drawn after every rotated one, so none may be above it.
  const blocked = late.some((obj) => rotated.some((r) => index.get(r) > index.get(obj) && overlap(bounds.get(r), bounds.get(obj))));
  return blocked ? null : late;
}

// Lays the rotated objects out upright, one under another, on transparent
// sheets (several only if one would get too tall) and captures each sheet
// once. Returns Map<object, { sheet, y }> locating each one on its sheet.
// Offsets are whole pixels so objects with fractional sizes don't get
// resampled differently from a lone capture.
async function captureRotatedObjects(rotated) {
  const sheets = [];
  let current = [];
  let height = 0;
  for (const obj of rotated) {
    const objHeight = Math.ceil(obj.h);
    if (current.length && height + objHeight > MAX_SHEET_HEIGHT) { sheets.push({ items: current, height }); current = []; height = 0; }
    current.push({ obj, y: height });
    height += objHeight;
  }
  if (current.length) sheets.push({ items: current, height });

  const located = new Map();
  for (const { items, height: sheetHeight } of sheets) {
    const sheetWidth = Math.ceil(Math.max(...items.map((item) => item.obj.w)));
    const placed = items.map(({ obj, y }) => ({
      ...obj, x: 0, y, rot: 0,
    }));
    // eslint-disable-next-line no-await-in-loop
    const sheet = await capture({ background: TRANSPARENT, objects: placed }, sheetWidth, sheetHeight, true);
    for (const { obj, y } of items) located.set(obj, { sheet, y });
  }
  return located;
}

export async function rasterizePage(pageData, widthPx, heightPx) {
  const ordered = stackingOrder(pageData);
  const rotated = ordered.filter((obj) => obj.rot);
  if (!rotated.length) {
    // Nothing rotated: the whole page is a single capture.
    return newCanvasFrom(await capture(pageData, widthPx, heightPx, false), widthPx, heightPx);
  }

  const bounds = new Map(ordered.map((obj) => [obj, boundsOf(obj)]));
  const late = planLateObjects(ordered, rotated, bounds);
  if (!late) return rasterizeSequentially(pageData, ordered, widthPx, heightPx);

  const lateSet = new Set(late);
  const early = ordered.filter((obj) => !obj.rot && !lateSet.has(obj));
  const canvas = newCanvasFrom(await capture({ ...pageData, objects: early }, widthPx, heightPx, false), widthPx, heightPx);
  const ctx = canvas.getContext('2d');

  const located = await captureRotatedObjects(rotated);
  for (const obj of rotated) {
    const { sheet, y } = located.get(obj);
    drawRotated(ctx, obj, sheet, 0, y);
  }
  if (late.length) ctx.drawImage(await capture({ background: TRANSPARENT, objects: late }, widthPx, heightPx, true), 0, 0);
  return canvas;
}
