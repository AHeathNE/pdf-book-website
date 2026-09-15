import { newZineProject, cloneProject, normalizeProject } from './schema.js';
import { getTemplate, isPosterSide, getSidePanels } from './templates.js';

const HISTORY_LIMIT = 60;

export const state = {
  project: newZineProject(),
  side: 'front', // 'front' | 'back'
  // Which panel new objects get added to, on a grid side; ignored on a
  // poster side (objects there always go straight into that side's one
  // { objects } bag — see getActivePanelData).
  activePanelId: 'front-cover',
  selection: null, // { side, panelId, objectId }
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

function firstPanelId(side) {
  const template = getTemplate(state.project.templateId);
  const panels = getSidePanels(template, side);
  return panels.length ? panels[0].id : null;
}

export function setSide(side) {
  const template = getTemplate(state.project.templateId);
  state.side = side === 'back' ? 'back' : 'front';
  if (isPosterSide(template, state.side)) {
    state.activePanelId = state.side;
  } else if (!state.project[state.side][state.activePanelId]) {
    state.activePanelId = firstPanelId(state.side);
  }
  selectObject(null, null, null);
}

// Returns the { objects } bag new objects get added to — the currently
// active panel on a grid side, or the single bag on a poster side.
export function getActivePanelData() {
  const template = getTemplate(state.project.templateId);
  if (isPosterSide(template, state.side)) return state.project[state.side];
  return state.project[state.side][state.activePanelId] || null;
}

export function loadProject(rawProject, { resetHistory = true } = {}) {
  state.project = normalizeProject(rawProject);
  state.side = 'front';
  const template = getTemplate(state.project.templateId);
  state.activePanelId = isPosterSide(template, 'front') ? 'front' : firstPanelId('front');
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

// Returns the live objects array for a panel on the given side (or the
// side's single bag, on a poster side) directly from state.project —
// callers mutate it in place inside a commit()/mutator.
export function getPanelObjects(side, panelId) {
  const template = getTemplate(state.project.templateId);
  if (isPosterSide(template, side)) return state.project[side].objects;
  const panel = state.project[side][panelId];
  return panel ? panel.objects : null;
}

export function selectObject(side, panelId, objectId) {
  state.selection = objectId ? { side, panelId, objectId } : null;
  notify();
}

export function getSelectedObject() {
  if (!state.selection) return null;
  const objs = getPanelObjects(state.selection.side, state.selection.panelId);
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
