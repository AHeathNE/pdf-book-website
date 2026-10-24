import { state } from './store.js';
import { rasterizePage } from './rasterize.js';
import { ditherToDots, canvasToPngBlob } from './dither.js';

// The editor canvas shows the dithered result of each page as an overlay on
// top of the live, still-editable objects. Dithering means rasterizing the
// page (html2canvas, a few hundred ms), so it can't run on every render:
// results are cached per page by a key covering everything that affects the
// pixels, rebuilt a moment after edits stop, and until then the page just
// shows its live, undithered content.

const REBUILD_DELAY_MS = 350;

const cache = new Map(); // pageId -> { key, url } (url null if rendering failed — don't retry until the key changes)
const queue = new Set();
let timer = null;
let running = false;
let onReady = () => {};

export function setDitherPreviewReadyHandler(fn) {
  onReady = fn;
}

function keyFor(page, book) {
  const { type, dotSize, contrast, brightness, ink, paper } = book.dither;
  return JSON.stringify([page, book.pageSize.widthPx, book.pageSize.heightPx, type, dotSize, contrast, brightness, ink, paper]);
}

function clearCache() {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
  queue.clear();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.size) {
      const [id] = queue;
      queue.delete(id);
      const { book } = state;
      const page = book.pages.find((p) => p.id === id);
      if (!page || !book.dither.enabled) continue;
      const key = keyFor(page, book);
      let url = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const raster = await rasterizePage(page, book.pageSize.widthPx, book.pageSize.heightPx);
        // eslint-disable-next-line no-await-in-loop
        const blob = await canvasToPngBlob(ditherToDots(raster, book.dither));
        url = URL.createObjectURL(blob);
      } catch (err) {
        console.error('Dither preview failed for a page', err);
      }
      const old = cache.get(id);
      if (old && old.url) URL.revokeObjectURL(old.url);
      cache.set(id, { key, url });
    }
  } finally {
    running = false;
  }
  onReady();
}

// The dithered image for this page if it's current, else null (and one is
// scheduled, which calls the ready handler when it lands).
export function getDitherPreviewUrl(page, book) {
  if (!book.dither.enabled) {
    if (cache.size) clearCache();
    return null;
  }
  const entry = cache.get(page.id);
  if (entry && entry.key === keyFor(page, book)) return entry.url;
  queue.add(page.id);
  clearTimeout(timer);
  timer = setTimeout(drain, REBUILD_DELAY_MS);
  return null;
}
