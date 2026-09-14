// The view-spin control: rotates the whole sheet on screen purely for
// editing comfort (the "punk-8up" template bakes a 180deg rotation into
// alternating panels, per templates.js, so a row that prints upside-down
// is upside-down on screen too until you spin the view to work on it).
// This is pure, per-browser view state — never part of the project data,
// and never applied on export (export always renders the true, unspun
// sheet — see export-pdf.js).

let spinDeg = Number(localStorage.getItem('zine-view-spin')) || 0;

const listeners = new Set();
export function onSpinChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSpin(deg) {
  spinDeg = ((deg % 360) + 360) % 360;
  localStorage.setItem('zine-view-spin', String(spinDeg));
  for (const fn of listeners) fn(spinDeg);
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
