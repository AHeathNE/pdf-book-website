import { rasterizePage } from './rasterize.js';
import { ditherToDots, canvasToPngBlob } from './dither.js';

// For a dithered book, renders every page to its dithered PNG (one pixel per
// dot) so a published viewer can lay them over the live pages. Returns
// Map<pageId, Blob>. Empty when the book isn't dithered.
export async function buildDitherPageImages(book, onProgress = () => {}) {
  const images = new Map();
  if (!book.dither.enabled) return images;
  const { widthPx, heightPx } = book.pageSize;
  for (let i = 0; i < book.pages.length; i += 1) {
    onProgress(i + 1, book.pages.length);
    const page = book.pages[i];
    // eslint-disable-next-line no-await-in-loop
    const raster = await rasterizePage(page, widthPx, heightPx);
    // eslint-disable-next-line no-await-in-loop
    images.set(page.id, await canvasToPngBlob(ditherToDots(raster, book.dither)));
  }
  return images;
}
