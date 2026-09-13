import { renderPage, applyStageBackground } from '../../shared/renderer.js';
import { computeSpreads } from '../../shared/pagination.js';
import { state, commit, checkpoint, selectObject } from './store.js';

const SNAP_THRESHOLD = 8; // native px

let zoom = 1;

// User-controlled zoom is a multiplier on top of the auto-fit size below,
// not an absolute scale — "100%" means "fit the viewport" (today's only
// behavior), so existing projects don't suddenly look different, and
// dialing up from there is relative to whatever the current window size
// already fits. Persisted per-browser like the other view-only prefs
// (unit, showTocFields, ...): it's not part of the book data.
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MIN_USER_ZOOM = ZOOM_STEPS[0];
const MAX_USER_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
let userZoom = Math.min(MAX_USER_ZOOM, Math.max(
  MIN_USER_ZOOM,
  Number(localStorage.getItem('pbw-editor-zoom')) || 1,
));

function computeZoom() {
  const viewport = document.getElementById('spreadViewport');
  const { widthPx, heightPx } = state.book.pageSize;
  const availW = viewport.clientWidth - 48;
  const availH = viewport.clientHeight - 48;
  // Always fit against the worst-case (two-page) spread so a page renders
  // at the same visual size whether it's shown alone (a cover) or paired
  // — matching how the exported viewer scales itself. Which dimension
  // doubles depends on which way pages pair: side by side (horizontal)
  // doubles the width; stacked (vertical) doubles the height instead.
  if (state.book.orientation === 'vertical') {
    return Math.max(0.05, Math.min(availW / widthPx, availH / (heightPx * 2), 1.5));
  }
  const totalW = widthPx * 2;
  return Math.max(0.05, Math.min(availW / totalW, availH / heightPx, 1.5));
}

function syncZoomControls() {
  const select = document.getElementById('zoomSelect');
  if (!select) return;
  // Snaps to the closest step so a persisted value from a since-removed
  // step (or a differently-sized page whose fit changed) still shows a
  // sensible reading instead of nothing.
  const closest = ZOOM_STEPS.reduce((a, b) => (Math.abs(b - userZoom) < Math.abs(a - userZoom) ? b : a));
  select.value = String(closest);
}

function applyUserZoom(z) {
  userZoom = Math.min(MAX_USER_ZOOM, Math.max(MIN_USER_ZOOM, z));
  localStorage.setItem('pbw-editor-zoom', String(userZoom));
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

// A standalone cover/back page has no facing page, so both sides use the
// outer margin rather than mirroring inner/outer across the spine.
// Whichever axis pages actually face each other across (left/right for a
// normal book, top/bottom for a vertical one) is the one inner/outer
// applies to — the book's margins.top/bottom fields do double duty as the
// fixed left/right margins in vertical mode, since that axis never
// mirrors between facing pages either way.
function marginBoxFor(book, side) {
  const { widthPx, heightPx } = book.pageSize;
  const { top, bottom, inner, outer } = book.margins;
  if (book.orientation === 'vertical') {
    const marginTop = side === 'bottom' ? inner : outer;
    const marginBottom = side === 'top' ? inner : outer;
    const left = top;
    const right = bottom;
    return {
      left, top: marginTop, right: widthPx - right, bottom: heightPx - marginBottom, width: widthPx - left - right, height: heightPx - marginTop - marginBottom,
    };
  }
  const left = side === 'right' ? inner : outer;
  const right = side === 'left' ? inner : outer;
  return { left, top, right: widthPx - right, bottom: heightPx - bottom, width: widthPx - left - right, height: heightPx - top - bottom };
}

// Grid lines are defined by a column/row COUNT (not a fixed px spacing),
// spanning either the full page or just the margin box, per grid.origin.
function computeGridLines(book, side) {
  const { widthPx, heightPx } = book.pageSize;
  const { columns, rows, origin } = book.grid;
  const box = origin === 'margins' ? marginBoxFor(book, side) : { left: 0, top: 0, width: widthPx, height: heightPx };
  const xLines = [];
  for (let i = 0; i <= columns; i += 1) xLines.push(box.left + (box.width * i) / columns);
  const yLines = [];
  for (let i = 0; i <= rows; i += 1) yLines.push(box.top + (box.height * i) / rows);
  return { xLines, yLines };
}

function snapCandidates(book, side, axis) {
  const { widthPx, heightPx } = book.pageSize;
  const box = marginBoxFor(book, side);
  const size = axis === 'x' ? widthPx : heightPx;
  const list = [0, size, size / 2];
  if (axis === 'x') list.push(box.left, box.right);
  else list.push(box.top, box.bottom);
  if (book.grid.snap) {
    const { xLines, yLines } = computeGridLines(book, side);
    list.push(...(axis === 'x' ? xLines : yLines));
  }
  return list;
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

function drawGuides(pageInnerEl, book, side) {
  const { widthPx, heightPx } = book.pageSize;
  const box = marginBoxFor(book, side);

  const marginEl = document.createElement('div');
  marginEl.className = 'pbw-guide pbw-guide--margin';
  marginEl.style.left = `${box.left}px`;
  marginEl.style.top = `${box.top}px`;
  marginEl.style.width = `${box.width}px`;
  marginEl.style.height = `${box.height}px`;
  pageInnerEl.appendChild(marginEl);

  if (book.grid.show) {
    const { xLines, yLines } = computeGridLines(book, side);
    // pageInnerEl is scaled by `transform: scale(zoom)`, so a native 1px
    // line renders at `zoom` real screen pixels — well under 1px whenever
    // the page is shrunk (e.g. a narrow viewport, DevTools open). Browsers
    // round that sub-pixel width inconsistently depending on exact
    // position, so lines can flicker in and out of visibility as the
    // viewport (and therefore zoom) changes, even though the underlying
    // positions never move. Sizing lines at `1 / zoom` native px keeps
    // them at a crisp, consistent 1 real screen pixel regardless of zoom.
    const lineThickness = 1 / zoom;
    for (const x of xLines) {
      const line = document.createElement('div');
      line.className = 'pbw-guide pbw-guide--grid-v';
      line.style.left = `${x - lineThickness / 2}px`;
      line.style.top = '0';
      line.style.width = `${lineThickness}px`;
      line.style.height = `${heightPx}px`;
      line.style.backgroundColor = book.grid.color;
      pageInnerEl.appendChild(line);
    }
    for (const y of yLines) {
      const line = document.createElement('div');
      line.className = 'pbw-guide pbw-guide--grid-h';
      line.style.top = `${y - lineThickness / 2}px`;
      line.style.left = '0';
      line.style.height = `${lineThickness}px`;
      line.style.width = `${widthPx}px`;
      line.style.backgroundColor = book.grid.color;
      pageInnerEl.appendChild(line);
    }
  }
}

function renderHandles(pageInnerEl, obj, onResizeStart) {
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
    pageInnerEl.appendChild(handle);
  }
}

// `pageData` is null for the synthetic filler page (inserted only so a
// requested standalone back cover comes out right regardless of the
// book's real page-count parity — see shared/pagination.js). It renders
// as a plain blank, non-interactive placeholder.
function buildPageSide(pageData, side, book) {
  const pageEl = document.createElement('div');
  pageEl.className = 'pbw-page';
  pageEl.style.width = `${book.pageSize.widthPx * zoom}px`;
  pageEl.style.height = `${book.pageSize.heightPx * zoom}px`;

  const inner = document.createElement('div');
  inner.className = 'pbw-page-inner';
  inner.style.width = `${book.pageSize.widthPx}px`;
  inner.style.height = `${book.pageSize.heightPx}px`;
  inner.style.transformOrigin = 'top left';
  inner.style.transform = `scale(${zoom})`;
  pageEl.appendChild(inner);

  if (!pageData) {
    pageEl.classList.add('pbw-page--filler');
    const label = document.createElement('div');
    label.className = 'pbw-filler-label';
    label.textContent = 'Blank (auto) — add/remove a page to change this';
    pageEl.appendChild(label);
    return pageEl;
  }

  pageEl.addEventListener('mousedown', (e) => {
    state.activePageId = pageData.id;
    if (e.target === pageEl || e.target === inner || e.target.classList.contains('pbw-guide')) {
      selectObject(null, null);
    }
  });

  const { objectEls } = renderPage(pageData, inner, {
    editable: true,
    onSelect: (objectId, evt) => startObjectDrag(pageData, objectId, side, evt),
  });

  drawGuides(inner, book, side);

  if (state.selection && state.selection.pageId === pageData.id) {
    const obj = pageData.objects.find((o) => o.id === state.selection.objectId);
    const el = objectEls.get(state.selection.objectId);
    if (obj && el) {
      el.classList.add('pbw-object--selected');
      renderHandles(inner, obj, (corner, evt) => startObjectResize(pageData, obj.id, side, corner, evt));
    }
  }

  return pageEl;
}

// Both entries carry the page-inner element currently on screen for that
// spread slot, freshly queried each call (never cached across a render),
// since a full canvas re-render tears down and rebuilds the DOM on every
// commit — including mid-drag.
function getCurrentSpreadEntries() {
  const spreads = getSpreads();
  const spread = spreads[state.spreadIndex] || [];
  if (spread.length < 2) return [];
  const innerEls = document.querySelectorAll('#spread .pbw-page-inner');
  const [sideA, sideB] = state.book.orientation === 'vertical' ? ['top', 'bottom'] : ['left', 'right'];
  return [
    { page: spread[0], side: sideA, inner: innerEls[0], rect: innerEls[0] ? innerEls[0].getBoundingClientRect() : null },
    { page: spread[1], side: sideB, inner: innerEls[1], rect: innerEls[1] ? innerEls[1].getBoundingClientRect() : null },
  ];
}

function startObjectDrag(pageData, objectId, side, evt) {
  state.activePageId = pageData.id;
  selectObject(pageData.id, objectId);
  let currentPage = pageData;
  let currentSide = side;
  const obj = currentPage.objects.find((o) => o.id === objectId);
  if (!obj) return;

  const startMouse = { x: evt.clientX, y: evt.clientY };
  const startBox = { x: obj.x, y: obj.y };
  let moved = false;

  function onMove(e) {
    const dx = (e.clientX - startMouse.x) / zoom;
    const dy = (e.clientY - startMouse.y) / zoom;
    if (!moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      moved = true;
      checkpoint();
    }
    if (!moved) return;

    let nx = startBox.x + dx;
    let ny = startBox.y + dy;

    // Dragging past the shared edge between two facing pages moves the
    // object onto the adjacent page, re-based to that page's coordinates.
    // Which screen axis that edge runs along depends on how pages face
    // each other: side by side (horizontal) share a vertical edge, so
    // crossing it is an X-axis check; stacked (vertical) share a
    // horizontal edge, so it's a Y-axis check instead.
    const vertical = state.book.orientation === 'vertical';
    const entries = getCurrentSpreadEntries();
    const mine = entries.find((en) => en.page && en.page.id === currentPage.id);
    const other = entries.find((en) => en.page && en.page.id !== currentPage.id);
    if (mine && mine.rect && other && other.rect && other.page) {
      const overOther = vertical
        ? (() => {
          const centerScreenY = mine.rect.top + (ny + obj.h / 2) * zoom;
          return centerScreenY >= other.rect.top && centerScreenY <= other.rect.bottom;
        })()
        : (() => {
          const centerScreenX = mine.rect.left + (nx + obj.w / 2) * zoom;
          return centerScreenX >= other.rect.left && centerScreenX <= other.rect.right;
        })();
      if (overOther) {
        const idx = currentPage.objects.findIndex((o) => o.id === obj.id);
        if (idx >= 0) currentPage.objects.splice(idx, 1);
        if (vertical) {
          const screenY = mine.rect.top + ny * zoom;
          ny = (screenY - other.rect.top) / zoom;
        } else {
          const screenX = mine.rect.left + nx * zoom;
          nx = (screenX - other.rect.left) / zoom;
        }
        other.page.objects.push(obj);
        currentPage = other.page;
        currentSide = other.side;
        selectObject(currentPage.id, obj.id);
        state.activePageId = currentPage.id;
        startMouse.x = e.clientX;
        startMouse.y = e.clientY;
        startBox.x = nx;
        startBox.y = ny;
      }
    }

    obj.x = snapPoint(nx, snapCandidates(state.book, currentSide, 'x'));
    obj.y = snapPoint(ny, snapCandidates(state.book, currentSide, 'y'));
    commit(() => {}, { history: false });
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startObjectResize(pageData, objectId, side, corner, evt) {
  const obj = pageData.objects.find((o) => o.id === objectId);
  if (!obj) return;
  checkpoint();

  const startMouse = { x: evt.clientX, y: evt.clientY };
  const start = { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
  const ratio = start.w / start.h;
  const MIN = 16;

  function onMove(e) {
    const dx = (e.clientX - startMouse.x) / zoom;
    const dy = (e.clientY - startMouse.y) / zoom;
    const xCandidates = snapCandidates(state.book, side, 'x');
    const yCandidates = snapCandidates(state.book, side, 'y');
    const lock = obj.lockRatio || e.shiftKey;

    let { x, y, w, h } = start;
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

export function getSpreads() {
  return computeSpreads(state.book.pages, state.book.covers);
}

export function renderCanvas() {
  const container = document.getElementById('spread');
  container.innerHTML = '';
  zoom = computeZoom() * userZoom;

  const book = state.book;
  const vertical = book.orientation === 'vertical';
  container.classList.toggle('spread--vertical', vertical);
  applyStageBackground(document.getElementById('spreadViewport'), book.background);
  const spreads = getSpreads();
  if (state.spreadIndex >= spreads.length) state.spreadIndex = Math.max(0, spreads.length - 1);
  const spread = spreads[state.spreadIndex] || [];

  if (spread.length === 1) {
    container.appendChild(buildPageSide(spread[0], 'single', book));
  } else {
    const [sideA, sideB] = vertical ? ['top', 'bottom'] : ['left', 'right'];
    container.appendChild(buildPageSide(spread[0] || null, sideA, book));
    container.appendChild(buildPageSide(spread[1] || null, sideB, book));
  }
}

window.addEventListener('resize', () => renderCanvas());

// A plain window resize listener misses internal layout shifts that
// change #spreadViewport's actual available space without the window
// itself changing size — e.g. a scrollbar in a side panel appearing or
// disappearing as the page's initial layout settles. When that happens
// on the very first automatic render (right after restoring a project),
// there's nothing left to trigger a follow-up render, so the page stays
// sized for whatever transient space it measured — it only gets fixed
// the next time something else (New Project, Import PDF, Open Project)
// happens to re-render on an already-settled page. A ResizeObserver
// reacts to the element's real size changing, whatever the cause, so it
// self-corrects instead of relying on a resize event that may never fire.
const spreadViewportEl = document.getElementById('spreadViewport');
if (spreadViewportEl) {
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
  resizeObserver.observe(spreadViewportEl);
}
