import { uid } from '../../shared/schema.js';
import { state, commit, selectObject, isTextEditingTarget } from './store.js';

// Not book data — a plain in-memory clipboard for one object at a time,
// scoped to this tab/session like a normal app clipboard.
let clipboard = null;

function getSelectedObjectAndPage() {
  if (!state.selection) return {};
  const page = state.book.pages.find((p) => p.id === state.selection.pageId);
  const obj = page && page.objects.find((o) => o.id === state.selection.objectId);
  return { page, obj };
}

function copySelected() {
  const { obj } = getSelectedObjectAndPage();
  if (!obj) return;
  clipboard = JSON.parse(JSON.stringify(obj));
}

function cutSelected() {
  const { page, obj } = getSelectedObjectAndPage();
  if (!obj) return;
  clipboard = JSON.parse(JSON.stringify(obj));
  commit(() => {
    const i = page.objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) page.objects.splice(i, 1);
  });
  selectObject(null, null);
}

// Pastes at the exact position/size it was copied/cut from — including
// onto the page it came from, landing right on top of the original spot.
function pasteToPage(targetPage) {
  if (!clipboard || !targetPage) return;
  const newObj = { ...clipboard, id: uid('obj') };
  commit(() => { targetPage.objects.push(newObj); });
  selectObject(targetPage.id, newObj.id);
}

// `getActivePage` is a function (not a page) so paste always targets
// whichever page is active *at paste time*, not at wiring time.
export function wireClipboardShortcuts(getActivePage) {
  window.addEventListener('keydown', (e) => {
    if (isTextEditingTarget()) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'c') {
      copySelected();
    } else if (key === 'x') {
      e.preventDefault();
      cutSelected();
    } else if (key === 'v') {
      e.preventDefault();
      pasteToPage(getActivePage());
    }
  });
}
