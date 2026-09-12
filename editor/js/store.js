import { newBook, cloneBook, normalizeBook } from '../../shared/schema.js';

const HISTORY_LIMIT = 60;

export const state = {
  book: newBook(),
  spreadIndex: 0, // pages shown are [2*spreadIndex, 2*spreadIndex+1]
  selection: null, // { pageId, objectId }
  activePageId: null, // last page clicked into — where new objects get added
  assets: new Map(), // blobUrl -> { filename, blob }
  undoStack: [],
  redoStack: [],
};

// True while focus is on a text-editing control, so global shortcuts
// (undo/redo, cut/copy/paste) can defer to the browser's native handling
// inside a field instead of hijacking it.
export function isTextEditingTarget() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  for (const fn of listeners) fn(state);
}

export function loadBook(rawBook, { resetHistory = true } = {}) {
  state.book = normalizeBook(rawBook);
  state.spreadIndex = 0;
  state.selection = null;
  state.activePageId = state.book.pages[0] ? state.book.pages[0].id : null;
  if (resetHistory) {
    state.undoStack = [];
    state.redoStack = [];
  }
  notify();
}

// Snapshot the current book onto the undo stack. Call once before a
// discrete edit or before a continuous drag/resize gesture begins — not on
// every intermediate mutation — so undo steps stay one-gesture-per-step.
export function checkpoint() {
  state.undoStack.push(cloneBook(state.book));
  if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

// Mutates state.book via `mutator(book)` and re-renders. Pass
// history:false for continuous in-gesture updates that already have a
// checkpoint from before the gesture started.
export function commit(mutator, { history = true } = {}) {
  if (history) checkpoint();
  mutator(state.book);
  notify();
}

export function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(cloneBook(state.book));
  state.book = state.undoStack.pop();
  notify();
}

export function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(cloneBook(state.book));
  state.book = state.redoStack.pop();
  notify();
}

export function selectObject(pageId, objectId) {
  state.selection = objectId ? { pageId, objectId } : null;
  notify();
}

export function getSelectedObject() {
  if (!state.selection) return null;
  const page = state.book.pages.find((p) => p.id === state.selection.pageId);
  if (!page) return null;
  return page.objects.find((o) => o.id === state.selection.objectId) || null;
}

export function getSelectedPage() {
  if (!state.selection) return null;
  return state.book.pages.find((p) => p.id === state.selection.pageId) || null;
}

// Registers a blob as a project asset and returns a stable blob: URL usable
// directly as an <img>/background src while editing. The same blob won't be
// duplicated if registered twice (by identity).
//
// Deliberately never revoked/pruned automatically: a blob URL can be
// "resurrected" later by undo (the undo stack holds plain string
// references into old book snapshots) or by paste (the clipboard holds a
// copy of a cut/copied object outside the book entirely), and revoking one
// out from under either would permanently kill that image — the object
// stays selectable (that's pure data) but its picture is gone for good,
// including through a reload since the purged asset stops being
// autosaved. The browser reclaims all blob URLs itself when this page is
// closed or reloaded, so there's no real leak to worry about here.
export function registerAsset(blob, filename) {
  const url = URL.createObjectURL(blob);
  state.assets.set(url, { filename, blob });
  return url;
}
