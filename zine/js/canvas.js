import { renderPage } from '../../shared/renderer.js';
import {
  state, commit, checkpoint, selectObject,
} from './store.js';
import {
  getTemplate, isPosterSide, getSideGrid, getSidePanels, getSideCutLine, getRowPanels,
} from './templates.js';
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

// Front panels and the back poster/panels are wildly different physical
// sizes, so the two sides keep independent margin values (see schema.js)
// — otherwise a margin sized for one can exceed half the other's width/
// height, clamping its guide to 0 for a whole range of edits.
function marginFor(side) {
  return side === 'back' ? state.project.backMargin : state.project.frontMargin;
}

// A panel's authoring ("local") space is rotated `rotate` degrees
// clockwise onto the flat sheet. For 90/270 that also SWAPS which local
// axis is "wide" (see contentSize below), so the simple axis-negation
// that sufficed for a 0/180-only template isn't enough here — this is
// the general inverse-rotation matrix, converting a screen-space mouse
// delta into the panel's local (pre-rotation) delta. cos/sin are rounded
// since our angles are always exact multiples of 90deg (avoids
// float noise like cos(90deg) landing on 6e-17 instead of 0).
function localDelta(dxScreen, dyScreen, rotateDeg) {
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return {
    dx: dxScreen * cos + dyScreen * sin,
    dy: -dxScreen * sin + dyScreen * cos,
  };
}

// The panel's own authoring/content box, sized so that rotating it by
// `rotate` degrees produces exactly the panelW x panelH cell it sits in
// (a 90/270 rotation swaps width and height; 0/180 doesn't).
function contentSize(rotateDeg, panelW, panelH) {
  return (rotateDeg % 180 !== 0) ? { w: panelH, h: panelW } : { w: panelW, h: panelH };
}

function drawPanelMarginGuide(containerEl, contentW, contentH, margin) {
  const marginEl = document.createElement('div');
  marginEl.className = 'pbw-guide pbw-guide--margin';
  marginEl.style.left = `${margin}px`;
  marginEl.style.top = `${margin}px`;
  marginEl.style.width = `${Math.max(0, contentW - margin * 2)}px`;
  marginEl.style.height = `${Math.max(0, contentH - margin * 2)}px`;
  containerEl.appendChild(marginEl);
}

function renderHandles(containerEl, obj, onResizeStart) {
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
    containerEl.appendChild(handle);
  }
}

// Fresh DOM query every call (never cached) — a full canvas re-render
// tears down and rebuilds the DOM on every commit, including mid-drag.
function getRowPanelRects(template, side, row) {
  return getRowPanels(template, side, row).map((panelDef) => {
    const el = document.querySelector(`.zine-panel[data-panel-id="${panelDef.id}"]`);
    return { panelDef, rect: el ? el.getBoundingClientRect() : null };
  });
}

// A 180deg-rotated panel mirrors both axes in place, so an object's LOCAL
// x doesn't match where it visually sits on screen. Used only for the
// same-row neighbor-transfer hit test below, which is restricted to
// 0/180 panels (see startObjectDrag) where this simple mirror is exact —
// a 90/270 crossing would need the full rotation matrix and isn't worth
// the added risk for a convenience feature.
function toVisual(local, size, boxSize, rotated) {
  return rotated ? boxSize - local - size : local;
}
function toLocal(visual, size, boxSize, rotated) {
  return rotated ? boxSize - visual - size : visual;
}

function startObjectDrag(side, panelDef, panelData, objectId, contentW, contentH, evt) {
  const template = getTemplate(state.project.templateId);
  state.activePanelId = panelDef.id;
  selectObject(side, panelDef.id, objectId);
  let currentPanelDef = panelDef;
  let currentPanelData = panelData;
  let currentContentW = contentW;
  const obj = currentPanelData.objects.find((o) => o.id === objectId);
  if (!obj) return;

  const startMouse = { x: evt.clientX, y: evt.clientY };
  const startBox = { x: obj.x, y: obj.y };
  let moved = false;

  function onMove(e) {
    const rawDx = (e.clientX - startMouse.x) / zoom;
    const rawDy = (e.clientY - startMouse.y) / zoom;
    const { dx, dy } = localDelta(rawDx, rawDy, currentPanelDef.rotate);
    if (!moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      moved = true;
      checkpoint();
    }
    if (!moved) return;

    let nx = startBox.x + dx;
    const ny = startBox.y + dy;

    // Dragging past a panel's left/right edge, on a grid side, moves the
    // object onto the neighboring panel in the same row — only attempted
    // when both panels share the same 0/180 rotation (see toVisual's
    // comment above); rotate 90/270, or a rotation change at the
    // boundary, just clamps within the current panel instead.
    const rotationSupportsTransfer = currentPanelDef.rotate === 0 || currentPanelDef.rotate === 180;
    if (!isPosterSide(template, side) && rotationSupportsTransfer) {
      const rotated = currentPanelDef.rotate === 180;
      const rowPanels = getRowPanelRects(template, side, currentPanelDef.row);
      const mine = rowPanels.find((r) => r.panelDef.id === currentPanelDef.id);
      if (mine && mine.rect) {
        const visX = toVisual(nx, obj.w, currentContentW, rotated);
        const screenCenterX = mine.rect.left + (visX + obj.w / 2) * zoom;
        const neighbor = rowPanels.find((r) => r.rect && r.panelDef.id !== currentPanelDef.id
          && (r.panelDef.rotate === 0 || r.panelDef.rotate === 180)
          && screenCenterX >= r.rect.left && screenCenterX <= r.rect.right);
        if (neighbor) {
          const idx = currentPanelData.objects.findIndex((o) => o.id === obj.id);
          if (idx >= 0) currentPanelData.objects.splice(idx, 1);
          const newVisX = (screenCenterX - neighbor.rect.left) / zoom - obj.w / 2;
          nx = toLocal(newVisX, obj.w, currentContentW, neighbor.panelDef.rotate === 180);
          const newPanelData = state.project[side][neighbor.panelDef.id];
          newPanelData.objects.push(obj);
          currentPanelDef = neighbor.panelDef;
          currentPanelData = newPanelData;
          selectObject(side, currentPanelDef.id, obj.id);
          state.activePanelId = currentPanelDef.id;
          startMouse.x = e.clientX;
          startMouse.y = e.clientY;
          startBox.x = nx;
          startBox.y = ny;
        }
      }
    }

    obj.x = snapPoint(nx, snapCandidatesFor(currentContentW, marginFor(side)));
    obj.y = snapPoint(ny, snapCandidatesFor(contentH, marginFor(side)));
    commit(() => {}, { history: false });
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startObjectResize(side, panelDef, panelData, objectId, contentW, contentH, corner, evt) {
  const obj = panelData.objects.find((o) => o.id === objectId);
  if (!obj) return;
  checkpoint();

  const startMouse = { x: evt.clientX, y: evt.clientY };
  const start = {
    x: obj.x, y: obj.y, w: obj.w, h: obj.h,
  };
  const ratio = start.w / start.h;
  const MIN = 16;

  function onMove(e) {
    const rawDx = (e.clientX - startMouse.x) / zoom;
    const rawDy = (e.clientY - startMouse.y) / zoom;
    const { dx, dy } = localDelta(rawDx, rawDy, panelDef.rotate);
    const xCandidates = snapCandidatesFor(contentW, marginFor(side));
    const yCandidates = snapCandidatesFor(contentH, marginFor(side));
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

// A panel's DOM is three nested boxes:
//   outer       fixed screen-space grid cell (position/size never
//               affected by rotation)
//   zoomLayer   establishes the NATIVE-px coordinate frame matching the
//               cell (panelW x panelH), scaled up to screen size
//   content     the panel's own authoring box (contentSize — swapped
//               for 90/270), centered in zoomLayer and rotated around
//               that center — renderPage() targets this directly, so
//               objects are authored in a space that, once rotated,
//               exactly fills the cell
function buildPanel(side, panelDef, panelData, panelW, panelH) {
  const outer = document.createElement('div');
  outer.className = 'zine-panel';
  outer.dataset.panelId = panelDef.id;
  outer.style.position = 'absolute';
  outer.style.left = `${panelDef.col * panelW * zoom}px`;
  outer.style.top = `${panelDef.row * panelH * zoom}px`;
  outer.style.width = `${panelW * zoom}px`;
  outer.style.height = `${panelH * zoom}px`;
  if (panelDef.id === state.activePanelId) outer.classList.add('zine-panel--active');

  const zoomLayer = document.createElement('div');
  zoomLayer.className = 'zine-panel-zoom-layer';
  zoomLayer.style.width = `${panelW}px`;
  zoomLayer.style.height = `${panelH}px`;
  zoomLayer.style.transformOrigin = 'top left';
  zoomLayer.style.transform = `scale(${zoom})`;
  outer.appendChild(zoomLayer);

  const { w: contentW, h: contentH } = contentSize(panelDef.rotate, panelW, panelH);
  const content = document.createElement('div');
  content.className = 'zine-panel-content pbw-page-inner';
  content.style.width = `${contentW}px`;
  content.style.height = `${contentH}px`;
  content.style.left = '50%';
  content.style.top = '50%';
  content.style.transform = `translate(-50%, -50%) rotate(${panelDef.rotate}deg)`;
  zoomLayer.appendChild(content);

  outer.addEventListener('mousedown', (e) => {
    state.activePanelId = panelDef.id;
    if (e.target === outer || e.target === zoomLayer || e.target === content || e.target.classList.contains('pbw-guide')) {
      selectObject(null, null, null);
    }
  });

  const { objectEls } = renderPage({ objects: panelData.objects, background: null }, content, {
    editable: true,
    onSelect: (objectId, evt) => startObjectDrag(side, panelDef, panelData, objectId, contentW, contentH, evt),
  });

  drawPanelMarginGuide(content, contentW, contentH, marginFor(side));

  if (state.selection && state.selection.side === side && state.selection.panelId === panelDef.id) {
    const obj = panelData.objects.find((o) => o.id === state.selection.objectId);
    const el = objectEls.get(state.selection.objectId);
    if (obj && el) {
      el.classList.add('pbw-object--selected');
      renderHandles(content, obj, (corner, evt) => startObjectResize(side, panelDef, panelData, obj.id, contentW, contentH, corner, evt));
    }
  }

  const label = document.createElement('div');
  label.className = 'zine-panel-label';
  label.textContent = panelDef.label;
  content.appendChild(label);

  return outer;
}

function buildPosterPanel(side, sideData, widthPx, heightPx) {
  const panelDef = {
    id: side, row: 0, col: 0, rotate: 0,
  };
  const outer = document.createElement('div');
  outer.className = 'zine-panel zine-panel--poster';
  outer.dataset.panelId = side;
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
    state.activePanelId = side;
    if (e.target === outer || e.target === inner || e.target.classList.contains('pbw-guide')) {
      selectObject(null, null, null);
    }
  });

  const { objectEls } = renderPage({ objects: sideData.objects, background: null }, inner, {
    editable: true,
    onSelect: (objectId, evt) => startObjectDrag(side, panelDef, sideData, objectId, widthPx, heightPx, evt),
  });

  drawPanelMarginGuide(inner, widthPx, heightPx, marginFor(side));

  if (state.selection && state.selection.side === side && state.selection.panelId === side) {
    const obj = sideData.objects.find((o) => o.id === state.selection.objectId);
    const el = objectEls.get(state.selection.objectId);
    if (obj && el) {
      el.classList.add('pbw-object--selected');
      renderHandles(inner, obj, (corner, evt) => startObjectResize(side, panelDef, sideData, obj.id, widthPx, heightPx, corner, evt));
    }
  }

  return outer;
}

function drawGridOverlay(sheetEl, template, side, widthPx, heightPx) {
  const overlay = document.createElement('div');
  overlay.className = 'zine-overlay';
  overlay.style.width = `${widthPx * zoom}px`;
  overlay.style.height = `${heightPx * zoom}px`;

  const { columns, rows } = getSideGrid(template, side);
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

  const cutLine = getSideCutLine(template, side);
  if (cutLine) {
    const { x1, x2, y } = cutLine;
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
  const { side } = state;

  if (isPosterSide(template, side)) {
    sheet.appendChild(buildPosterPanel(side, state.project[side], widthPx, heightPx));
  } else {
    const grid = getSideGrid(template, side);
    const panelW = widthPx / grid.columns;
    const panelH = heightPx / grid.rows;
    for (const panelDef of getSidePanels(template, side)) {
      const panelData = state.project[side][panelDef.id];
      sheet.appendChild(buildPanel(side, panelDef, panelData, panelW, panelH));
    }
    drawGridOverlay(sheet, template, side, widthPx, heightPx);
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
