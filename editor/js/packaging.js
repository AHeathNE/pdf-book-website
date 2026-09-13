// Turns the in-memory book (whose image/background src fields are live
// blob: URLs, valid only for this page's lifetime) into a portable form:
// a book.json with those URLs rewritten to relative "assets/<name>" paths,
// plus the list of asset files to write alongside it. Shared by Save
// Project (zip) and Export Website.

import { cloneBook } from '../../shared/schema.js';
import { state } from './store.js';

export function packageAssets(book) {
  const clone = cloneBook(book);
  const usedNames = new Set();
  const urlToPath = new Map();

  function uniqueName(base) {
    let name = base;
    let n = 1;
    while (usedNames.has(name)) {
      n += 1;
      const dot = base.lastIndexOf('.');
      name = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
    }
    usedNames.add(name);
    return name;
  }

  function ensurePath(url) {
    if (urlToPath.has(url)) return urlToPath.get(url);
    const info = state.assets.get(url);
    const rawBase = info ? info.filename : `asset-${urlToPath.size + 1}`;
    const safeBase = rawBase.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const path = `assets/${uniqueName(safeBase)}`;
    urlToPath.set(url, path);
    return path;
  }

  function rewrite(value) {
    return typeof value === 'string' && value.startsWith('blob:') ? ensurePath(value) : value;
  }

  if (clone.background && clone.background.type === 'image') {
    clone.background.value = rewrite(clone.background.value);
  }
  for (const page of clone.pages) {
    if (page.background && page.background.type === 'image') {
      page.background.value = rewrite(page.background.value);
    }
    for (const obj of page.objects) {
      if (obj.type === 'image') obj.src = rewrite(obj.src);
    }
  }

  const files = [...urlToPath.entries()].map(([url, path]) => ({ path, blob: state.assets.get(url).blob }));
  return { bookJson: clone, files };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Same idea as packageAssets, but for a standalone single-file export:
// every image/gif is embedded directly as a data: URI instead of a
// separate asset file, so the exported book is one .html with nothing
// else to keep alongside it.
export async function packageAssetsInline(book) {
  const clone = cloneBook(book);
  const cache = new Map(); // blob: URL -> data: URL, so a reused asset is only encoded once

  async function rewrite(value) {
    if (typeof value !== 'string' || !value.startsWith('blob:')) return value;
    if (cache.has(value)) return cache.get(value);
    const info = state.assets.get(value);
    if (!info) return value;
    const dataUrl = await blobToDataUrl(info.blob);
    cache.set(value, dataUrl);
    return dataUrl;
  }

  if (clone.background && clone.background.type === 'image') {
    clone.background.value = await rewrite(clone.background.value);
  }
  for (const page of clone.pages) {
    if (page.background && page.background.type === 'image') {
      page.background.value = await rewrite(page.background.value);
    }
    for (const obj of page.objects) {
      if (obj.type === 'image') obj.src = await rewrite(obj.src);
    }
  }
  return clone;
}
