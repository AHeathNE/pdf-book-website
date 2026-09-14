import { renderPage } from '../../shared/renderer.js';
import {
  state, commit, checkpoint, selectObject,
} from './store.js';
import { getTemplate, getRowPanels } from './templates.js';
import {
  getSpinDeg, onViewChange, getShowGuides,
} from './view.js';

const SNAP_THRESHOLD = 8; // native px

let zoom = 1;

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MIN_USER_ZOOM = ZOOM_STEPS[0];
const MAX_USER_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
let userZoom = Math.min(MAX_USER_ZOOM, Math.max(
  MIN_USER_ZOOM,
  Number(localStorage.getItem('zine-editor-zoom')) || 1,
));

// The view-spin swaps which sheet dimension is "wide" on screen at 90/270,
// so fitting has to measure against the swapped box at those angles.
function computeZoom() {
  const viewport = document.getElementById('sheetViewport');
  const { widthPx, heightPx } = state.project.pageSize;
  const swapped = getSpinDeg() % 180 !== 0;
  const w = swapped ? heightPx : widthPx;
  const h = swapped ? widthPx : heightPx;
  const availW = viewport.clientWidth - 48;
  const availH = viewport.clientHeight - 48;
  return Math.max(0.05, Math.min(availW / w, availH / h, 3));
}

function syncZoomControls() {
  const select = document.getElementById('zoomSelect');
  if (!select) return;
  const closest = ZOOM_STEPS.reduce((a, b) => (Math.abs(b - userZoom) < Math.abs(a - userZoom) ? b : a));
  select.value = String(closest);
}

function applyUserZoom(z) {
  userZoom = Math.min(MAX_USER_ZOOM, Math.max(MIN_USER_ZOOM, z));
  localStorage.setItem('zine-editor-zoom', String(userZoom));
  syncZoomControls();
  renderCanvas();
}

export function zoomIn() {
  const next = ZOOM_STEPS.find((s) => s > userZoom + 0.001);
  applyUserZoom(next === undefined ? MAX_USER_ZOOM : next);
}
export function zoomOut() {
  const prev = [...ZOOM_STEPS].reverse().find((s) => s < userZoom - 0.001);
  applyUserZoom(prev === undefined ? MIN_USER_ZOOM : prev);
}
export function zoomReset() {
  applyUserZoom(1);
}

export function initZoomControls() {
  document.getElementById('zoomSelect').addEventListener('change', (e) => applyUserZoom(Number(e.target.value)));
  document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
  document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
  document.getElementById('zoomFitBtn').addEventListener('click', zoomReset);
  syncZoomControls();
}

function snapPoint(value, candidates) {
  let best = value;
  let bestDist = SNAP_THRESHOLD;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function snapCandidatesFor(size, margin) {
  return [0, size, size / 2, margin, size - margin];
}

// A 180deg-rotated panel mirrors both axes, so an object's LOCAL
// (authoring) x doesn't match where it visually sits on screen. These
// convert between the two — used so drag/resize math can work in local
// (authored) coordinates throughout, and only convert to/from screen
// terms at the edges (hit-testing neighbor panels).
function toVisual(local, size, boxSize, rotated) {
  return rotated ? boxSize - local - size : local;
}
function toLocal(visual, size, boxSize, rotated) {
  return rotated ? boxSize - visual - size : visual;
}

function drawPanelMarginGuide(innerEl, panelW, panelH, margin) {
  const marginEl = document.createElement('div');
  marginEl.className = 'pbw-guide pbw-guide--margin';
  marginEl.style.left = `${margin}px`;
  marginEl.style.top = `${margin}px`;
  marginEl.style.width = `${Math.max(0, panelW - margin * 2)}px`;
  marginEl.style.height = `${Math.max(0, panelH - margin * 2)}px`;
  innerEl.appendChild(marginEl);
}

function renderHandles(innerEl, obj, onResizeStart) {
  const corners = [
    ['nw', obj.x, obj.y],
    ['ne', obj.x + obj.w, obj.y],
    ['sw', obj.x, obj.y + obj.h],
    ['se', obj.x + obj.w, obj.y + obj.h],
  ];
  for (const [corner, cx, cy] of corners) {
    const handle = document.createElement('div');
    handle.className = 'pbw-handle';
    handle.style.left = `${cx - 5}px`;
    handle.style.top = `${cy - 5}px`;
    handle.style.cursor = corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize';
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onResizeStart(corner, e);
    });
    innerEl.appendChild(handle);
  }
}

// Fresh DOM query every call (never cached) — a full canvas re-render
// tears down and rebuilds the DOM on every commit, including mid-drag.
function getRowPanelRects(template, row) {
  return getRowPanels(template, row).map((panelDef) => {
    const el = document.querySelector(`.zine-panel[data-panel-id="${panelDef.id}"]`);
    return { panelDef, rect: el ? el.getBoundingClientRect() : null };
  });
}

function startObjectDrag(panelDef, panelData, objectId, panelW, panelH, evt) {
  const template = getTemplate(state.project.templateId);
  state.activePanelId = panelDef.id;
  selectObject(panelDef.id, objectId);
  let currentPanelDef = panelDef;
  let currentPanelData = panelData;
  const obj = currentPanelData.objects.find((o) => o.id === objectId);
  if (!obj) return;

  const startMouse = { x: evt.clientX, y: evt.clientY };
  const startBox = { x: obj.x, y: obj.y };
  let moved = false;

  function onMove(e) {
    const rotated = currentPanelDef.rotate === 180;
    const rawDx = (e.clientX - startMouse.x) / zoom;
    const rawDy = (e.clientY - startMouse.y) / zoom;
    const dx = rotated ? -rawDx : rawDx;
    const dy = rotated ? -rawDy : rawDy;
    if (!moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      moved = true;
      checkpoint();
    }
    if (!moved) return;

    let nx = startBox.x + dx;
    const ny = startBox.y + dy;

    // Dragging past a panel's left/right edge, on the front side, moves
    // the object onto the neighboring panel in the same row (same row =
    // same baked rotation, so this is a plain coordinate rebase).
    if (state.side === 'front' && panelDef.id !== 'back') {
      const rowPanels = getRowPanelRects(template, currentPanelDef.row);
      const mine = rowPanels.find((r) => r.panelDef.id === currentPanelDef.id);
      if (mine && mine.rect) {
        const visX = toVisual(nx, obj.w, panelW, rotated);
        const screenCenterX = mine.rect.left + (visX + obj.w / 2) * zoom;
        const neighbor = rowPanels.find((r) => r.rect && r.panelDef.id !== currentPanelDef.id
          && screenCenterX >= r.rect.left && screenCenterX <= r.rect.right);
        if (neighbor) {
          const idx = currentPanelData.objects.findIndex((o) => o.id === obj.id);
          if (idx >= 0) currentPanelData.objects.splice(idx, 1);
          const newVisX = (screenCenterX - neighbor.rect.left) / zoom - obj.w / 2;
          nx = toLocal(newVisX, obj.w, panelW, neighbor.panelDef.rotate === 180);
          const newPanelData = state.project.front[neighbor.panelDef.id];
          newPanelData.objects.push(obj);
          currentPanelDef = neighbor.panelDef;
          currentPanelData = newPanelData;
          selectObject(currentPanelDef.id, obj.id);
          state.activePanelId = currentPanelDef.id;
          startMouse.x = e.clientX;
          startMouse.y = e.clientY;
          startBox.x = nx;
          startBox.y = ny;
        }
      }
    }

    obj.x = snapPoint(nx, snapCandidatesFor(panelW, state.project.margin));
    obj.y = snapPoint(ny, snapCandidatesFor(panelH, state.project.margin));
    commit(() => {}, { history: false });
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startObjectResize(panelDef, panelData, objectId, panelW, panelH, corner, evt) {
  const obj = panelData.objects.find((o) => o.id === objectId);
  if (!obj) return;
  checkpoint();

  const rotated = panelDef.rotate === 180;
  const startMouse = { x: evt.clientX, y: evt.clientY };
  const start = {
    x: obj.x, y: obj.y, w: obj.w, h: obj.h,
  };
  const ratio = start.w / start.h;
  const MIN = 16;

  function onMove(e) {
    const rawDx = (e.clientX - startMouse.x) / zoom;
    const rawDy = (e.clientY - startMouse.y) / zoom;
    const dx = rotated ? -rawDx : rawDx;
    const dy = rotated ? -rawDy : rawDy;
    const xCandidates = snapCandidatesFor(panelW, state.project.margin);
    const yCandidates = snapCandidatesFor(panelH, state.project.margin);
    const lock = obj.lockRatio || e.shiftKey;

    let {
      x, y, w, h,
    } = start;
    if (corner === 'se') {
      const right = snapPoint(start.x + start.w + dx, xCandidates);
      w = Math.max(MIN, right - start.x);
      if (lock) { h = w / ratio; } else {
        const bottom = snapPoint(start.y + start.h + dy, yCandidates);
        h = Math.max(MIN, bottom - start.y);
      }
    } else if (corner === 'nw') {
      const left = snapPoint(start.x + dx, xCandidates);
      w = Math.max(MIN, start.x + start.w - left);
      x = start.x + start.w - w;
      if (lock) { h = w / ratio; y = start.y + start.h - h; } else {
        const top = snapPoint(start.y + dy, yCandidates);
        h = Math.max(MIN, start.y + start.h - top);
        y = start.y + start.h - h;
      }
    } else if (corner === 'ne') {
      const right = snapPoint(start.x + start.w + dx, xCandidates);
      w = Math.max(MIN, right - start.x);
      if (lock) { h = w / ratio; y = start.y + start.h - h; } else {
        const top = snapPoint(start.y + dy, yCandidates);
        h = Math.max(MIN, start.y + start.h - top);
        y = start.y + start.h - h;
      }
    } else if (corner === 'sw') {
      const left = snapPoint(start.x + dx, xCandidates);
      w = Math.max(MIN, start.x + start.w - left);
      x = start.x + start.w - w;
      if (lock) { h = w / ratio; } else {
        const bottom = snapPoint(start.y + start.h + dy, yCandidates);
        h = Math.max(MIN, bottom - start.y);
      }
    }

    obj.x = x; obj.y = y; obj.w = w; obj.h = h;
    commit(() => {}, { history: false });
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function buildPanel(panelDef, panelData, panelW, panelH) {
  const outer = document.createElement('div');
  outer.className = 'zine-panel';
  outer.dataset.panelId = panelDef.id;
  outer.style.position = 'absolute';
  outer.style.left = `${panelDef.col * panelW * zoom}px`;
  outer.style.top = `${panelDef.row * panelH * zoom}px`;
  outer.style.width = `${panelW * zoom}px`;
  outer.style.height = `${panelH * zoom}px`;
  if (panelDef.id === state.activePanelId && state.side === 'front') outer.classList.add('zine-panel--active');

  const rotator = document.createElement('div');
  rotator.className = 'zine-panel-rotator';
  rotator.style.width = '100%';
  rotator.style.height = '100%';
  rotator.style.transform = panelDef.rotate ? `rotate(${panelDef.rotate}deg)` : '';
  outer.appendChild(rotator);

  const inner = document.createElement('div');
  inner.className = 'zine-panel-inner pbw-page-inner';
  inner.style.width = `${panelW}px`;
  inner.style.height = `${panelH}px`;
  inner.style.transformOrigin = 'top left';
  inner.style.transform = `scale(${zoom})`;
  rotator.appendChild(inner);

  outer.addEventListener('mousedown', (e) => {
    state.activePanelId = panelDef.id;
    if (e.target === outer || e.target === rotator || e.target === inner || e.target.classList.contains('pbw-guide')) {
      selectObject(null, null);
    }
  });

  const { objectEls } = renderPage({ objects: panelData.objects, background: null }, inner, {
    editable: true,
    onSelect: (objectId, evt) => startObjectDrag(panelDef, panelData, objectId, panelW, panelH, evt),
  });

  drawPanelMarginGuide(inner, panelW, panelH, state.project.margin);

  if (state.selection && state.selection.panelId === panelDef.id) {
    const obj = panelData.objects.find((o) => o.id === state.selection.objectId);
    const el = objectEls.get(state.selection.objectId);
    if (obj && el) {
      el.classList.add('pbw-object--selected');
      renderHandles(inner, obj, (corner, evt) => startObjectResize(panelDef, panelData, obj.id, panelW, panelH, corner, evt));
    }
  }

  const label = document.createElement('div');
  label.className = 'zine-panel-label';
  label.textContent = panelDef.label;
  rotator.appendChild(label);

  return outer;
}

function buildBackPanel(backData, widthPx, heightPx) {
  const panelDef = {
    id: 'back', row: 0, col: 0, rotate: 0,
  };
  const outer = document.createElement('div');
  outer.className = 'zine-panel zine-panel--poster';
  outer.dataset.panelId = 'back';
  outer.style.position = 'absolute';
  outer.style.left = '0';
  outer.style.top = '0';
  outer.style.width = `${widthPx * zoom}px`;
  outer.style.height = `${heightPx * zoom}px`;

  const inner = document.createElement('div');
  inner.className = 'zine-panel-inner pbw-page-inner';
  inner.style.width = `${widthPx}px`;
  inner.style.height = `${heightPx}px`;
  inner.style.transformOrigin = 'top left';
  inner.style.transform = `scale(${zoom})`;
  outer.appendChild(inner);

  outer.addEventListener('mousedown', (e) => {
    state.activePanelId = 'back';
    if (e.target === outer || e.target === inner || e.target.classList.contains('pbw-guide')) {
      selectObject(null, null);
    }
  });

  const { objectEls } = renderPage({ objects: backData.objects, background: null }, inner, {
    editable: true,
    onSelect: (objectId, evt) => startObjectDrag(panelDef, backData, objectId, widthPx, heightPx, evt),
  });

  drawPanelMarginGuide(inner, widthPx, heightPx, state.project.margin);

  if (state.selection && state.selection.panelId === 'back') {
    const obj = backData.objects.find((o) => o.id === state.selection.objectId);
    const el = objectEls.get(state.selection.objectId);
    if (obj && el) {
      el.classList.add('pbw-object--selected');
      renderHandles(inner, obj, (corner, evt) => startObjectResize(panelDef, backData, obj.id, widthPx, heightPx, corner, evt));
    }
  }

  return outer;
}

function drawFrontOverlay(sheetEl, template, widthPx, heightPx) {
  const overlay = document.createElement('div');
  overlay.className = 'zine-overlay';
  overlay.style.width = `${widthPx * zoom}px`;
  overlay.style.height = `${heightPx * zoom}px`;

  const { columns, rows } = template.grid;
  for (let c = 1; c < columns; c += 1) {
    const line = document.createElement('div');
    line.className = 'zine-guide-line zine-guide-line--v';
    line.style.left = `${((widthPx * c) / columns) * zoom}px`;
    overlay.appendChild(line);
  }
  for (let r = 1; r < rows; r += 1) {
    const line = document.createElement('div');
    line.className = 'zine-guide-line zine-guide-line--h';
    line.style.top = `${((heightPx * r) / rows) * zoom}px`;
    overlay.appendChild(line);
  }

  if (template.cutLine) {
    const { x1, x2, y } = template.cutLine;
    const cutEl = document.createElement('div');
    cutEl.className = 'zine-cut-line';
    cutEl.style.left = `${widthPx * x1 * zoom}px`;
    cutEl.style.top = `${heightPx * y * zoom}px`;
    cutEl.style.width = `${widthPx * (x2 - x1) * zoom}px`;
    overlay.appendChild(cutEl);
  }

  sheetEl.appendChild(overlay);
}

export function renderCanvas() {
  const sheetSpin = document.getElementById('sheetSpin');
  const sheet = document.getElementById('sheet');
  sheet.innerHTML = '';
  zoom = computeZoom() * userZoom;

  const spinDeg = getSpinDeg();
  sheetSpin.style.transform = spinDeg ? `rotate(${spinDeg}deg)` : '';

  const { widthPx, heightPx } = state.project.pageSize;
  sheet.style.width = `${widthPx * zoom}px`;
  sheet.style.height = `${heightPx * zoom}px`;
  sheet.classList.toggle('zine-guides-hidden', !getShowGuides());

  const template = getTemplate(state.project.templateId);

  if (state.side === 'front') {
    const panelW = widthPx / template.grid.columns;
    const panelH = heightPx / template.grid.rows;
    for (const panelDef of template.panels) {
      const panelData = state.project.front[panelDef.id];
      sheet.appendChild(buildPanel(panelDef, panelData, panelW, panelH));
    }
    drawFrontOverlay(sheet, template, widthPx, heightPx);
  } else {
    sheet.appendChild(buildBackPanel(state.project.back, widthPx, heightPx));
  }
}

onViewChange(() => renderCanvas());

window.addEventListener('resize', () => renderCanvas());

const sheetViewportEl = document.getElementById('sheetViewport');
if (sheetViewportEl) {
  let lastObservedSize = '';
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.borderBoxSize && entry.borderBoxSize[0];
      const key = box ? `${box.inlineSize}x${box.blockSize}` : `${entry.contentRect.width}x${entry.contentRect.height}`;
      if (key === lastObservedSize) continue;
      lastObservedSize = key;
      renderCanvas();
    }
  });
  resizeObserver.observe(sheetViewportEl);
}
