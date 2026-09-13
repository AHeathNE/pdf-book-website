import { newPage, newTextObject, newImageObject, newLinkObject } from '../../shared/schema.js';
import { computeSpreads, findSpreadIndexForPageId } from '../../shared/pagination.js';
import { renderPage } from '../../shared/renderer.js';
import {
  state, commit, checkpoint, selectObject, registerAsset,
} from './store.js';
import {
  unitToPx, unitStep, formatForUnit, pxToPt, ptToPx,
} from './units.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

// Browsers can restore a form field's previous value on reload (Firefox in
// particular does this fairly aggressively) and, in doing so, sometimes
// fire the same 'input' event a real edit would — with no focus involved
// at all. For a plain text field that's harmless (a stray value gets
// overwritten by the real one on next render), but for a field like DPI,
// whose handler rescales the *entire book* based on the old vs. new
// value, a single such phantom event can silently multiply every
// dimension in the project before the user has touched anything
// (confirmed directly: dispatching a synthetic 'input' with no focus
// doubled the page size). Real typing always happens while the field has
// focus, so requiring that filters out every non-genuine trigger.
function bindLiveField(el, eventName, applyFn) {
  let checkpointed = false;
  el.addEventListener('focus', () => { checkpointed = false; });
  el.addEventListener(eventName, () => {
    if (document.activeElement !== el) return;
    if (!checkpointed) { checkpoint(); checkpointed = true; }
    applyFn(el.value);
    commit(() => {}, { history: false });
  });
}

// Display unit for page-size/margin fields and the two layout-helper
// checkboxes below are pure editing conveniences — not part of the book
// data model, so they aren't saved with the project. Unit is remembered
// per-browser since there's no reason to reset it every reload.
let unit = localStorage.getItem('pbw-unit') || 'in';
let lockRatio = false;
let sameMargins = false;
let showTocFields = localStorage.getItem('pbw-show-toc-fields') === 'true';
let showPagePreviews = localStorage.getItem('pbw-show-page-previews') === 'true';

// The four booklet sizes the viewer's height-scaling was tuned around
// (see viewer/viewer.js) — kept in inches here since that's how they're
// specified regardless of the book's own unit/DPI settings.
const PAGE_SIZE_PRESETS = [
  { id: 'letter', wIn: 8.5, hIn: 11 },
  { id: 'quarter-letter-tall', wIn: 4.25, hIn: 11 },
  { id: 'half-letter', wIn: 5.5, hIn: 8.5 },
  { id: 'quarter-letter', wIn: 4.25, hIn: 5.5 },
];

// DPI is the conversion factor between px and real-world units (used for
// unit display and for sizing the PDF export), not a separate "quality"
// knob — px values don't otherwise carry any physical size. So changing
// DPI alone, without rescaling every px value that depends on it, would
// silently change the book's physical size (e.g. doubling DPI without
// this would halve the exported PDF's page size) and throw off every
// object's proportion to the page. Rescaling everything here keeps DPI
// changes a pure resolution change: same physical page, same layout.
function rescaleBookForNewDpi(book, scale) {
  if (scale === 1) return;
  book.pageSize.widthPx = Math.round(book.pageSize.widthPx * scale);
  book.pageSize.heightPx = Math.round(book.pageSize.heightPx * scale);
  book.margins.top = Math.round(book.margins.top * scale);
  book.margins.bottom = Math.round(book.margins.bottom * scale);
  book.margins.inner = Math.round(book.margins.inner * scale);
  book.margins.outer = Math.round(book.margins.outer * scale);
  for (const page of book.pages) {
    for (const obj of page.objects) {
      obj.x = Math.round(obj.x * scale);
      obj.y = Math.round(obj.y * scale);
      obj.w = Math.round(obj.w * scale);
      obj.h = Math.round(obj.h * scale);
      if (obj.type === 'text') obj.fontSize = Math.round(obj.fontSize * scale);
    }
  }
}

// ---- Page list ----

// Typing in a page's TOC-label field triggers a commit on every keystroke
// like any other field, which would otherwise tear this whole list down
// and rebuild it (losing focus after one character) since the list is
// fully rebuilt on every render. Skip the rebuild when the set/order of
// pages hasn't changed and focus is on one of these inputs — nothing
// about the list structure needs to change just because a label's text
// changed.
let lastRenderedPageSignature = null;

function renderPageList() {
  const list = document.getElementById('pageList');
  const signature = state.book.pages.map((p) => p.id).join(',');
  const active = document.activeElement;
  const focusedTocInput = list.contains(active) && active.classList.contains('page-toc-input');
  document.getElementById('pageCount').textContent = `(${state.book.pages.length})`;
  if (focusedTocInput && signature === lastRenderedPageSignature) return;
  lastRenderedPageSignature = signature;

  list.innerHTML = '';
  const spreads = computeSpreads(state.book.pages, state.book.covers);
  state.book.pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'page-list-item';
    if (findSpreadIndexForPageId(spreads, page.id) === state.spreadIndex) item.classList.add('active');

    const row = document.createElement('div');
    row.className = 'page-list-row';
    const info = document.createElement('div');
    info.className = 'page-list-info';
    if (showPagePreviews) info.appendChild(buildThumbPlaceholder(page));
    const label = document.createElement('span');
    label.textContent = `Page ${i + 1}`;
    info.appendChild(label);
    row.appendChild(info);
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Delete page';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.book.pages.length <= 1) return;
      commit((book) => { book.pages.splice(i, 1); });
      const newSpreads = computeSpreads(state.book.pages, state.book.covers);
      state.spreadIndex = Math.min(state.spreadIndex, newSpreads.length - 1);
      state.activePageId = state.book.pages[0] ? state.book.pages[0].id : null;
      selectObject(null, null);
    });
    row.appendChild(del);
    item.appendChild(row);

    const tocInput = document.createElement('input');
    tocInput.type = 'text';
    tocInput.className = 'page-toc-input';
    tocInput.placeholder = 'Add to Table of Contents…';
    tocInput.value = page.tocLabel || '';
    tocInput.title = 'Appears in the published book’s Table of Contents when set';
    tocInput.hidden = !showTocFields;
    bindLiveField(tocInput, 'input', (v) => { page.tocLabel = v || null; });
    item.appendChild(tocInput);

    item.addEventListener('click', (e) => {
      if (e.target === tocInput) return;
      state.spreadIndex = findSpreadIndexForPageId(spreads, page.id);
      state.activePageId = page.id;
      selectObject(null, null);
    });
    list.appendChild(item);
  });
  scheduleThumbnailRefresh();
}

// Page previews reuse the same live-DOM-scaled-down technique as the
// viewer's actual pages (renderPage() into a full-size wrapper, shrunk with
// a CSS transform) rather than rasterizing each one — no html2canvas, no
// extra image encoding. The placeholder created here is empty; content is
// filled in by renderVisibleThumbnails() so a rebuild triggered by, say,
// every tick of an on-canvas drag doesn't also re-render every visible
// page's full object tree on every tick.
function buildThumbPlaceholder(page) {
  const { widthPx, heightPx } = state.book.pageSize;
  const thumbW = 36;
  const thumbH = Math.round(thumbW * (heightPx / widthPx));
  const thumb = document.createElement('div');
  thumb.className = 'page-thumb';
  thumb.dataset.pageId = page.id;
  thumb.style.width = `${thumbW}px`;
  thumb.style.height = `${thumbH}px`;
  const inner = document.createElement('div');
  inner.className = 'page-thumb-inner';
  inner.style.width = `${widthPx}px`;
  inner.style.height = `${heightPx}px`;
  inner.style.transformOrigin = 'top left';
  inner.style.transform = `scale(${thumbW / widthPx})`;
  thumb.appendChild(inner);
  return thumb;
}

let thumbnailTimer = null;
function scheduleThumbnailRefresh() {
  if (!showPagePreviews) return;
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(renderVisibleThumbnails, 200);
}

// Only (re)renders thumbnails currently scrolled into view within #pageList
// — cost stays flat (bounded by however many rows fit, ~6) instead of
// growing with total page count.
function renderVisibleThumbnails() {
  const list = document.getElementById('pageList');
  const listRect = list.getBoundingClientRect();
  list.querySelectorAll('.page-thumb').forEach((thumb) => {
    const r = thumb.getBoundingClientRect();
    if (r.bottom < listRect.top || r.top > listRect.bottom) return;
    const page = state.book.pages.find((p) => p.id === thumb.dataset.pageId);
    if (!page) return;
    renderPage(page, thumb.firstElementChild, { editable: false });
  });
}

function initPageControls() {
  const showTocFieldsInput = document.getElementById('showTocFieldsInput');
  showTocFieldsInput.checked = showTocFields;
  showTocFieldsInput.addEventListener('change', (e) => {
    showTocFields = e.target.checked;
    localStorage.setItem('pbw-show-toc-fields', String(showTocFields));
    lastRenderedPageSignature = null;
    renderPageList();
  });

  const showPagePreviewsInput = document.getElementById('showPagePreviewsInput');
  showPagePreviewsInput.checked = showPagePreviews;
  showPagePreviewsInput.addEventListener('change', (e) => {
    showPagePreviews = e.target.checked;
    localStorage.setItem('pbw-show-page-previews', String(showPagePreviews));
    lastRenderedPageSignature = null;
    renderPageList();
  });
  document.getElementById('pageList').addEventListener('scroll', scheduleThumbnailRefresh);

  document.getElementById('addPageBtn').addEventListener('click', () => {
    const page = newPage();
    commit((book) => book.pages.push(page));
    const spreads = computeSpreads(state.book.pages, state.book.covers);
    state.spreadIndex = findSpreadIndexForPageId(spreads, page.id);
    state.activePageId = page.id;
  });

  document.getElementById('coverFrontInput').addEventListener('change', (e) => {
    commit((book) => { book.covers.front = e.target.checked; });
  });
  document.getElementById('coverBackInput').addEventListener('change', (e) => {
    commit((book) => { book.covers.back = e.target.checked; });
  });
}

// ---- Book setup ----

function initBookSetup() {
  const titleInput = document.getElementById('bookTitleInput');
  bindLiveField(titleInput, 'input', (v) => { state.book.title = v; });

  const unitSelect = document.getElementById('unitSelect');
  unitSelect.value = unit;
  unitSelect.addEventListener('change', () => {
    unit = unitSelect.value;
    localStorage.setItem('pbw-unit', unit);
    syncBookSetupInputs();
  });

  bindLiveField(document.getElementById('dpiInput'), 'input', (v) => {
    const newDpi = Math.max(1, Number(v) || 150);
    const oldDpi = state.book.pageSize.dpi;
    rescaleBookForNewDpi(state.book, newDpi / oldDpi);
    state.book.pageSize.dpi = newDpi;
  });

  bindLiveField(document.getElementById('pageWidthInput'), 'input', (v) => {
    const dpi = state.book.pageSize.dpi;
    const newWidthPx = Math.max(1, unitToPx(Number(v) || 0, unit, dpi));
    if (lockRatio) {
      const ratio = state.book.pageSize.heightPx / state.book.pageSize.widthPx;
      state.book.pageSize.heightPx = Math.round(newWidthPx * ratio);
    }
    state.book.pageSize.widthPx = Math.round(newWidthPx);
  });
  bindLiveField(document.getElementById('pageHeightInput'), 'input', (v) => {
    const dpi = state.book.pageSize.dpi;
    const newHeightPx = Math.max(1, unitToPx(Number(v) || 0, unit, dpi));
    if (lockRatio) {
      const ratio = state.book.pageSize.widthPx / state.book.pageSize.heightPx;
      state.book.pageSize.widthPx = Math.round(newHeightPx * ratio);
    }
    state.book.pageSize.heightPx = Math.round(newHeightPx);
  });
  document.getElementById('lockRatioInput').addEventListener('change', (e) => { lockRatio = e.target.checked; });

  document.getElementById('orientationSelect').addEventListener('change', (e) => {
    commit((book) => { book.orientation = e.target.value; });
  });

  document.getElementById('pageSizePresetInput').addEventListener('change', (e) => {
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === e.target.value);
    if (!preset) return; // 'custom' — leave the current size as-is
    commit((book) => {
      const dpi = book.pageSize.dpi;
      book.pageSize.widthPx = Math.round(preset.wIn * dpi);
      book.pageSize.heightPx = Math.round(preset.hIn * dpi);
    });
  });

  function marginField(id, key) {
    bindLiveField(document.getElementById(id), 'input', (v) => {
      const dpi = state.book.pageSize.dpi;
      const px = Math.max(0, unitToPx(Number(v) || 0, unit, dpi));
      if (sameMargins) {
        state.book.margins.top = px;
        state.book.margins.bottom = px;
        state.book.margins.inner = px;
        state.book.margins.outer = px;
      } else {
        state.book.margins[key] = px;
      }
    });
  }
  marginField('marginTopInput', 'top');
  marginField('marginBottomInput', 'bottom');
  marginField('marginInnerInput', 'inner');
  marginField('marginOuterInput', 'outer');
  document.getElementById('sameMarginsInput').addEventListener('change', (e) => {
    sameMargins = e.target.checked;
    if (sameMargins) {
      commit((book) => {
        const v = book.margins.top;
        book.margins.bottom = v; book.margins.inner = v; book.margins.outer = v;
      });
    }
  });

  bindLiveField(document.getElementById('gridColumnsInput'), 'input', (v) => { state.book.grid.columns = Math.max(1, Math.round(Number(v)) || 1); });
  bindLiveField(document.getElementById('gridRowsInput'), 'input', (v) => { state.book.grid.rows = Math.max(1, Math.round(Number(v)) || 1); });
  bindLiveField(document.getElementById('gridColorInput'), 'input', (v) => { state.book.grid.color = v; });
  document.getElementById('gridOriginSelect').addEventListener('change', (e) => {
    commit((book) => { book.grid.origin = e.target.value; });
  });
  document.getElementById('gridSnapInput').addEventListener('change', (e) => {
    commit((book) => { book.grid.snap = e.target.checked; });
  });
  document.getElementById('gridShowInput').addEventListener('change', (e) => {
    commit((book) => { book.grid.show = e.target.checked; });
  });
}

function syncBookSetupInputs() {
  const b = state.book;
  const dpi = b.pageSize.dpi;
  const step = unitStep(unit);

  document.getElementById('bookTitleInput').value = b.title;
  document.getElementById('dpiInput').value = dpi;

  const widthIn = b.pageSize.widthPx / dpi;
  const heightIn = b.pageSize.heightPx / dpi;
  const matchedPreset = PAGE_SIZE_PRESETS.find(
    (p) => Math.abs(p.wIn - widthIn) < 0.02 && Math.abs(p.hIn - heightIn) < 0.02,
  );
  document.getElementById('pageSizePresetInput').value = matchedPreset ? matchedPreset.id : 'custom';

  const widthInput = document.getElementById('pageWidthInput');
  const heightInput = document.getElementById('pageHeightInput');
  widthInput.step = step;
  heightInput.step = step;
  if (document.activeElement !== widthInput) widthInput.value = formatForUnit(b.pageSize.widthPx, unit, dpi);
  if (document.activeElement !== heightInput) heightInput.value = formatForUnit(b.pageSize.heightPx, unit, dpi);

  [['marginTopInput', 'top'], ['marginBottomInput', 'bottom'], ['marginInnerInput', 'inner'], ['marginOuterInput', 'outer']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.step = step;
    if (document.activeElement !== el) el.value = formatForUnit(b.margins[key], unit, dpi);
  });

  document.getElementById('lockRatioInput').checked = lockRatio;
  document.getElementById('sameMarginsInput').checked = sameMargins;

  document.getElementById('orientationSelect').value = b.orientation;
  const vertical = b.orientation === 'vertical';
  document.getElementById('marginsLabel').textContent = vertical
    ? 'Margins (left / right / inner / outer)'
    : 'Margins (top / bottom / inner / outer)';
  document.getElementById('marginTopInput').title = vertical ? 'Left' : 'Top';
  document.getElementById('marginBottomInput').title = vertical ? 'Right' : 'Bottom';

  const columnsInput = document.getElementById('gridColumnsInput');
  const rowsInput = document.getElementById('gridRowsInput');
  if (document.activeElement !== columnsInput) columnsInput.value = b.grid.columns;
  if (document.activeElement !== rowsInput) rowsInput.value = b.grid.rows;
  const gridColorInput = document.getElementById('gridColorInput');
  if (document.activeElement !== gridColorInput) gridColorInput.value = b.grid.color;
  document.getElementById('gridOriginSelect').value = b.grid.origin;
  document.getElementById('gridSnapInput').checked = b.grid.snap;
  document.getElementById('gridShowInput').checked = b.grid.show;

  document.getElementById('coverFrontInput').checked = b.covers.front;
  document.getElementById('coverBackInput').checked = b.covers.back;
}

// ---- Background ----

function initBackgroundControls() {
  const typeSelect = document.getElementById('backgroundTypeSelect');
  const colorInput = document.getElementById('backgroundColorInput');
  const gradientInput = document.getElementById('backgroundGradientInput');
  const imageBtn = document.getElementById('backgroundImageBtn');
  const imageInput = document.getElementById('backgroundImageInput');

  typeSelect.addEventListener('change', () => {
    commit((book) => {
      const type = typeSelect.value;
      if (type === 'color') book.background = { type, value: colorInput.value };
      else if (type === 'gradient') book.background = { type, value: gradientInput.value || 'linear-gradient(#222,#000)' };
      else book.background = { type, value: state.book.background.value || '', fit: state.book.background.fit || 'cover' };
    });
  });
  bindLiveField(colorInput, 'input', (v) => { state.book.background = { type: 'color', value: v }; });
  bindLiveField(gradientInput, 'input', (v) => { state.book.background = { type: 'gradient', value: v }; });
  imageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const url = registerAsset(file, file.name);
    commit((book) => { book.background = { type: 'image', value: url, fit: state.book.background.fit || 'cover' }; });
    imageInput.value = '';
  });
  document.getElementById('backgroundFitSelect').addEventListener('change', (e) => {
    commit((book) => { book.background.fit = e.target.value; });
  });
}

function syncBackgroundInputs() {
  const bg = state.book.background;
  document.getElementById('backgroundTypeSelect').value = bg.type;
  document.getElementById('backgroundColorInput').style.display = bg.type === 'color' ? '' : 'none';
  document.getElementById('backgroundGradientInput').style.display = bg.type === 'gradient' ? '' : 'none';
  document.getElementById('backgroundImageBtn').style.display = bg.type === 'image' ? '' : 'none';
  document.getElementById('backgroundFitLabel').style.display = bg.type === 'image' ? '' : 'none';
  if (bg.type === 'color') document.getElementById('backgroundColorInput').value = bg.value;
  if (bg.type === 'gradient') document.getElementById('backgroundGradientInput').value = bg.value;
  if (bg.type === 'image') document.getElementById('backgroundFitSelect').value = bg.fit || 'cover';
}

// ---- Palette (add objects) ----

export function getActivePage() {
  const found = state.book.pages.find((p) => p.id === state.activePageId);
  if (found) return found;
  const spreads = computeSpreads(state.book.pages, state.book.covers);
  const spread = spreads[state.spreadIndex] || [];
  return spread.find(Boolean) || state.book.pages[0];
}

function addObjectToActivePage(obj) {
  const page = getActivePage();
  if (!page) return;
  commit(() => { page.objects.push(obj); });
  selectObject(page.id, obj.id);
}

function scaledImageSize(img, maxW, maxH) {
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  return { w: Math.round(img.naturalWidth * ratio), h: Math.round(img.naturalHeight * ratio) };
}

function initPalette() {
  document.querySelectorAll('#palette [data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      if (kind === 'text') addObjectToActivePage(newTextObject());
      else if (kind === 'link') addObjectToActivePage(newLinkObject());
      else if (kind === 'image') document.getElementById('imageFileInput').click();
      else if (kind === 'gif') document.getElementById('gifFileInput').click();
    });
  });

  function handleImageFile(input) {
    const file = input.files[0];
    if (!file) return;
    const url = registerAsset(file, file.name);
    const img = new Image();
    img.onload = () => {
      const { widthPx, heightPx } = state.book.pageSize;
      const { w, h } = scaledImageSize(img, widthPx * 0.6, heightPx * 0.6);
      addObjectToActivePage(newImageObject({ src: url, alt: file.name, w, h }));
    };
    img.src = url;
    input.value = '';
  }
  document.getElementById('imageFileInput').addEventListener('change', (e) => handleImageFile(e.target));
  document.getElementById('gifFileInput').addEventListener('change', (e) => handleImageFile(e.target));
}

// ---- Properties panel ----

function field(labelText, inputEl) {
  const wrap = document.createElement('div');
  wrap.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function numberInput(value, onChange) {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = Math.round(value);
  bindLiveField(input, 'input', (v) => onChange(Number(v) || 0));
  return input;
}

// obj.fontSize is stored as native px (tied to the book's DPI, like every
// other object dimension — see rescaleBookForNewDpi), but "px at whatever
// DPI this book happens to use" isn't a size anyone actually thinks in.
// Type size is conventionally set in points everywhere else (Word, PDF
// tools, InDesign...), so this field is deliberately in pt regardless of
// the page's own display unit (in/cm/px) — a plain unlabeled px number
// here previously read as a normal-looking size (e.g. "20") while actually
// rendering far smaller than that, since 20 native px at a 150dpi page is
// under 10pt.
function fontSizeInput(obj) {
  const dpi = state.book.pageSize.dpi;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.step = '0.5';
  input.value = Math.round(pxToPt(obj.fontSize, dpi) * 10) / 10;
  bindLiveField(input, 'input', (v) => {
    const pt = Math.max(1, Number(v) || 1);
    obj.fontSize = Math.round(ptToPx(pt, dpi));
  });
  return input;
}

// A field mid-edit inside this panel gets torn down and rebuilt (losing
// focus and cursor position) on every keystroke unless we skip rebuilding
// when nothing about the selection itself has changed.
let lastRenderedObjId = null;

// Common cross-platform "web-safe" stacks — these are the fonts most
// likely to actually be installed on a random site visitor's computer, so
// a book built with one of these still looks right once exported (unlike
// an arbitrary font pulled from the author's own machine, which a visitor
// without it installed will simply never see).
const FONT_PRESETS = [
  'Georgia, serif',
  'Times New Roman, Times, serif',
  'Garamond, serif',
  'Palatino Linotype, Book Antiqua, Palatino, serif',
  'Arial, Helvetica, sans-serif',
  'Helvetica, Arial, sans-serif',
  'Verdana, Geneva, sans-serif',
  'Trebuchet MS, sans-serif',
  'Tahoma, Geneva, sans-serif',
  'Segoe UI, sans-serif',
  'Courier New, Courier, monospace',
  'Lucida Console, Monaco, monospace',
  'Comic Sans MS, sans-serif',
  'Impact, sans-serif',
  'Brush Script MT, cursive',
];

// Populated on demand via the Local Font Access API (Chrome/Edge only —
// Firefox and Safari don't implement it, and it's gated behind a
// permission prompt, so this only ever grows from a direct button click,
// never automatically). Cached for the rest of the session once granted,
// so switching between text objects doesn't need to re-ask.
let detectedLocalFonts = [];

function buildFontField(obj) {
  const wrap = document.createElement('div');

  const controlsRow = document.createElement('div');
  controlsRow.className = 'row';

  const select = document.createElement('select');
  const options = [...new Set([...FONT_PRESETS, ...detectedLocalFonts])];
  if (!options.includes(obj.fontFamily)) options.unshift(obj.fontFamily);
  for (const f of options) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.split(',')[0].trim();
    opt.style.fontFamily = f;
    if (f === obj.fontFamily) opt.selected = true;
    select.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom…';
  select.appendChild(customOpt);

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = 'Exact font family name';
  customInput.value = obj.fontFamily;
  customInput.hidden = true;
  customInput.style.marginTop = '4px';
  customInput.title = 'A visitor without this exact font installed will see the page’s default font instead.';
  bindLiveField(customInput, 'input', (v) => { obj.fontFamily = v || obj.fontFamily; });

  select.addEventListener('change', () => {
    if (select.value === '__custom__') {
      customInput.hidden = false;
      customInput.focus();
      return;
    }
    commit(() => { obj.fontFamily = select.value; });
  });

  const systemBtn = document.createElement('button');
  systemBtn.type = 'button';
  systemBtn.textContent = 'Use system fonts…';
  systemBtn.title = 'Chrome/Edge only. Lets you pick from fonts installed on this computer — a site visitor without that font installed will see the fallback font instead.';
  systemBtn.addEventListener('click', async () => {
    if (typeof window.queryLocalFonts !== 'function') {
      setStatus('This browser can’t list system fonts (Firefox and Safari don’t support it) — use Custom… to type an exact font name instead.');
      return;
    }
    try {
      const handles = await window.queryLocalFonts();
      detectedLocalFonts = [...new Set(handles.map((h) => h.family))].sort();
      renderProperties();
    } catch (err) {
      setStatus('Font access wasn’t granted.');
    }
  });

  controlsRow.appendChild(select);
  controlsRow.appendChild(systemBtn);
  wrap.appendChild(controlsRow);
  wrap.appendChild(customInput);
  return wrap;
}

function renderProperties() {
  const panel = document.getElementById('propertiesPanel');
  const page = state.selection && state.book.pages.find((p) => p.id === state.selection.pageId);
  const obj = page && page.objects.find((o) => o.id === state.selection.objectId);

  const active = document.activeElement;
  const focusedFieldInPanel = panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (obj && focusedFieldInPanel && lastRenderedObjId === obj.id) return;
  lastRenderedObjId = obj ? obj.id : null;

  panel.innerHTML = '';
  if (!obj) {
    panel.innerHTML = '<p class="hint">Select an object to edit it.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid4';
  grid.appendChild(field('X', numberInput(obj.x, (v) => { obj.x = v; })));
  grid.appendChild(field('Y', numberInput(obj.y, (v) => { obj.y = v; })));
  grid.appendChild(field('Width', numberInput(obj.w, (v) => {
    const newW = Math.max(1, v);
    if (obj.lockRatio) obj.h = Math.round(newW * (obj.h / obj.w));
    obj.w = newW;
  })));
  grid.appendChild(field('Height', numberInput(obj.h, (v) => {
    const newH = Math.max(1, v);
    if (obj.lockRatio) obj.w = Math.round(newH * (obj.w / obj.h));
    obj.h = newH;
  })));
  panel.appendChild(grid);

  const lockRow = document.createElement('label');
  lockRow.className = 'row';
  const lockCheckbox = document.createElement('input');
  lockCheckbox.type = 'checkbox';
  lockCheckbox.checked = obj.lockRatio;
  lockCheckbox.addEventListener('change', () => commit(() => { obj.lockRatio = lockCheckbox.checked; }));
  lockRow.appendChild(lockCheckbox);
  lockRow.appendChild(document.createTextNode(' Lock ratio (or hold Shift while resizing)'));
  panel.appendChild(lockRow);

  panel.appendChild(field('Rotation (deg)', numberInput(obj.rot, (v) => { obj.rot = v; })));

  if (obj.type === 'text') {
    const textarea = document.createElement('textarea');
    textarea.value = obj.content;
    bindLiveField(textarea, 'input', (v) => { obj.content = v; });
    panel.appendChild(field('Text', textarea));

    panel.appendChild(field('Font', buildFontField(obj)));

    panel.appendChild(field('Font size (pt)', fontSizeInput(obj)));

    const color = document.createElement('input');
    color.type = 'color';
    color.value = obj.color;
    bindLiveField(color, 'input', (v) => { obj.color = v; });
    panel.appendChild(field('Color', color));

    const align = document.createElement('select');
    ['left', 'center', 'right'].forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      if (a === obj.align) opt.selected = true;
      align.appendChild(opt);
    });
    align.addEventListener('change', () => commit(() => { obj.align = align.value; }));
    panel.appendChild(field('Align', align));
  }

  if (obj.type === 'image') {
    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace Image…';
    replaceBtn.className = 'block';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = obj.src.endsWith('.gif') ? 'image/gif' : 'image/*';
    fileInput.hidden = true;
    replaceBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const url = registerAsset(file, file.name);
      commit(() => { obj.src = url; });
    });
    panel.appendChild(field('Image', replaceBtn));
    panel.appendChild(fileInput);

    const alt = document.createElement('input');
    alt.type = 'text';
    alt.value = obj.alt || '';
    bindLiveField(alt, 'input', (v) => { obj.alt = v; });
    panel.appendChild(field('Alt text', alt));

    const link = document.createElement('input');
    link.type = 'url';
    link.placeholder = 'https:// (optional link)';
    link.value = obj.link || '';
    bindLiveField(link, 'input', (v) => { obj.link = v || null; });
    panel.appendChild(field('Link URL', link));
  }

  if (obj.type === 'link') {
    const href = document.createElement('input');
    href.type = 'url';
    href.value = obj.href;
    bindLiveField(href, 'input', (v) => { obj.href = v; });
    panel.appendChild(field('URL', href));

    const label = document.createElement('input');
    label.type = 'text';
    label.value = obj.label;
    bindLiveField(label, 'input', (v) => { obj.label = v; });
    panel.appendChild(field('Label', label));

    const bg = document.createElement('input');
    bg.type = 'color';
    bg.value = obj.bgColor;
    bindLiveField(bg, 'input', (v) => { obj.bgColor = v; });
    panel.appendChild(field('Button color', bg));

    const fg = document.createElement('input');
    fg.type = 'color';
    fg.value = obj.textColor;
    bindLiveField(fg, 'input', (v) => { obj.textColor = v; });
    panel.appendChild(field('Text color', fg));
  }

  const layerRow = document.createElement('div');
  layerRow.className = 'row';
  const front = document.createElement('button');
  front.textContent = 'Bring to front';
  front.addEventListener('click', () => commit(() => {
    const maxZ = Math.max(0, ...page.objects.map((o) => o.z));
    obj.z = maxZ + 1;
  }));
  const back = document.createElement('button');
  back.textContent = 'Send to back';
  back.addEventListener('click', () => commit(() => {
    const minZ = Math.min(0, ...page.objects.map((o) => o.z));
    obj.z = minZ - 1;
  }));
  layerRow.appendChild(front);
  layerRow.appendChild(back);
  panel.appendChild(layerRow);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete object';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', deleteSelectedObject);
  panel.appendChild(deleteBtn);
}

// Shared by the Properties panel's Delete button and the Delete/Backspace
// keyboard shortcut (wired in main.js).
export function deleteSelectedObject() {
  if (!state.selection) return;
  const page = state.book.pages.find((p) => p.id === state.selection.pageId);
  const obj = page && page.objects.find((o) => o.id === state.selection.objectId);
  if (!page || !obj) return;
  commit(() => {
    const i = page.objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) page.objects.splice(i, 1);
  });
  selectObject(null, null);
}

// ---- Public API ----

export function initPanels() {
  initPageControls();
  initBookSetup();
  initBackgroundControls();
  initPalette();
}

export function renderPanels() {
  renderPageList();
  syncBookSetupInputs();
  syncBackgroundInputs();
  renderProperties();
}
