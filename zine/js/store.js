import { newZineProject, cloneProject, normalizeProject } from './schema.js';

const HISTORY_LIMIT = 60;

export const state = {
  project: newZineProject(),
  side: 'front', // 'front' | 'back'
  // Which panel new objects get added to. 'back' when state.side==='back',
  // otherwise a front panel id (see zine/js/templates.js).
  activePanelId: 'front-cover',
  selection: null, // { panelId, objectId }
  assets: new Map(), // blobUrl -> { filename, blob }
  undoStack: [],
  redoStack: [],
};

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

export function setSide(side) {
  state.side = side === 'back' ? 'back' : 'front';
  state.activePanelId = state.side === 'back' ? 'back' : (state.activePanelId === 'back' ? Object.keys(state.project.front)[0] : state.activePanelId);
  selectObject(null, null);
}

// Returns the { objects } bag new objects get added to — the currently
// active panel on the front, or the poster on the back.
export function getActivePanelData() {
  if (state.side === 'back') return state.project.back;
  return state.project.front[state.activePanelId] || null;
}

export function loadProject(rawProject, { resetHistory = true } = {}) {
  state.project = normalizeProject(rawProject);
  state.side = 'front';
  state.activePanelId = Object.keys(state.project.front)[0] || null;
  state.selection = null;
  if (resetHistory) {
    state.undoStack = [];
    state.redoStack = [];
  }
  notify();
}

export function checkpoint() {
  state.undoStack.push(cloneProject(state.project));
  if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
  state.redoStack = [];
}

export function commit(mutator, { history = true } = {}) {
  if (history) checkpoint();
  mutator(state.project);
  notify();
}

export function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(cloneProject(state.project));
  state.project = state.undoStack.pop();
  notify();
}

export function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(cloneProject(state.project));
  state.project = state.redoStack.pop();
  notify();
}

// Returns the live objects array for a panel id ('back', or a front panel
// id) directly from state.project — callers mutate it in place inside a
// commit()/mutator.
export function getPanelObjects(panelId) {
  if (panelId === 'back') return state.project.back.objects;
  const panel = state.project.front[panelId];
  return panel ? panel.objects : null;
}

export function selectObject(panelId, objectId) {
  state.selection = objectId ? { panelId, objectId } : null;
  notify();
}

export function getSelectedObject() {
  if (!state.selection) return null;
  const objs = getPanelObjects(state.selection.panelId);
  return objs ? objs.find((o) => o.id === state.selection.objectId) || null : null;
}

// Registers a blob as a project asset and returns a stable blob: URL usable
// directly as an <img> src while editing. Never revoked/pruned — see the
// identical rationale in editor/js/store.js (undo/paste can resurrect an
// old reference; the browser reclaims blob URLs itself on reload).
export function registerAsset(blob, filename) {
  const url = URL.createObjectURL(blob);
  state.assets.set(url, { filename, blob });
  return url;
}
