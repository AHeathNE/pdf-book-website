// View-only controls: the spin (rotates the whole sheet on screen purely
// for editing comfort — the "punk-8up" template bakes a 180deg rotation
// into alternating panels, per templates.js, so a row that prints
// upside-down is upside-down on screen too until you spin the view to
// work on it) and the template-guides toggle below. Both are pure,
// per-browser view state — never part of the project data, and never
// applied on export (export always renders the true, unspun sheet with
// no guides at all — see export-pdf.js).

let spinDeg = Number(localStorage.getItem('zine-view-spin')) || 0;

// Shared by both controls: either one changing means the canvas needs a
// re-render.
const listeners = new Set();
export function onViewChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyViewChange() {
  for (const fn of listeners) fn();
}

function setSpin(deg) {
  spinDeg = ((deg % 360) + 360) % 360;
  localStorage.setItem('zine-view-spin', String(spinDeg));
  notifyViewChange();
}

export function getSpinDeg() {
  return spinDeg;
}

export function rotateView90() {
  setSpin(spinDeg + 90);
}

export function flipView180() {
  setSpin(spinDeg + 180);
}

export function resetView() {
  setSpin(0);
}

export function initSpinControls() {
  document.getElementById('rotate90Btn').addEventListener('click', rotateView90);
  document.getElementById('flip180Btn').addEventListener('click', flipView180);
  document.getElementById('resetSpinBtn').addEventListener('click', resetView);
}

// Whether the template's editing-only guides (panel divider lines, safe-
// margin box, cut-line, panel outline) are shown.
let showGuides = localStorage.getItem('zine-show-guides') !== 'false';

export function getShowGuides() {
  return showGuides;
}

function setShowGuides(value) {
  showGuides = value;
  localStorage.setItem('zine-show-guides', String(showGuides));
  notifyViewChange();
}

export function initGuidesToggle() {
  const input = document.getElementById('showGuidesInput');
  input.checked = showGuides;
  input.addEventListener('change', () => setShowGuides(input.checked));
}

// Whether each panel's name/orientation label is shown — independent of
// showGuides above, so you can turn off the grid/cut-line clutter while
// keeping the labels, or vice versa, on any template. The label itself
// always rotates with the panel's baked orientation (it's rendered
// inside the same rotated content box as the panel's objects — see
// canvas.js's buildPanel), so upright/upside-down/sideways is conveyed
// by the label's own reading direction, not by extra text.
let showLabels = localStorage.getItem('zine-show-labels') !== 'false';

export function getShowLabels() {
  return showLabels;
}

function setShowLabels(value) {
  showLabels = value;
  localStorage.setItem('zine-show-labels', String(showLabels));
  notifyViewChange();
}

export function initLabelsToggle() {
  const input = document.getElementById('showLabelsInput');
  input.checked = showLabels;
  input.addEventListener('change', () => setShowLabels(input.checked));
}
