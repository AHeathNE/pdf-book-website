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
