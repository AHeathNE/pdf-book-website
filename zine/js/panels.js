import { newTextObject, newImageObject } from '../../shared/schema.js';
import { pageSizeForPreset, ensurePanelsForTemplate } from './schema.js';
import {
  TEMPLATES, getTemplate, isPosterSide, getSideGrid, getSidePanels,
} from './templates.js';
import {
  state, commit, checkpoint, selectObject, registerAsset, setSide, getActivePanelData, getPanelObjects,
} from './store.js';
import {
  unitToPx, unitStep, formatForUnit, pxToPt, ptToPx,
} from '../../editor/js/units.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

// See editor/js/panels.js's identical helper for why focus-gating matters
// here (a browser can restore/refire a stray 'input' event with no focus
// involved, which would otherwise checkpoint/apply a phantom edit).
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

let unit = localStorage.getItem('zine-unit') || 'in';
let lockRatio = false;

// ---- Toolbar / title ----

function initTitle() {
  bindLiveField(document.getElementById('zineTitleInput'), 'input', (v) => { state.project.title = v; });
}

// ---- Template ----

function initTemplateControls() {
  const select = document.getElementById('templateSelect');
  for (const template of Object.values(TEMPLATES)) {
    const opt = document.createElement('option');
    opt.value = template.id;
    opt.textContent = template.name;
    select.appendChild(opt);
  }
  select.addEventListener('change', (e) => {
    commit((project) => {
      project.templateId = e.target.value;
      ensurePanelsForTemplate(project);
    });
    // The previously active panel might not exist on the new template's
    // current side (most templates share panel ids on the front, so this
    // is usually a no-op) — fall back to that side's first panel, or to
    // the side name itself if it's now a poster.
    const template = getTemplate(state.project.templateId);
    if (isPosterSide(template, state.side)) {
      state.activePanelId = state.side;
    } else if (!state.project[state.side][state.activePanelId]) {
      const panels = getSidePanels(template, state.side);
      state.activePanelId = panels.length ? panels[0].id : null;
    }
  });
}

// ---- Sheet setup (paper size, margin) ----

// Front panels and the back poster are wildly different physical sizes,
// so the safe-margin guide is tracked independently per side (see
// schema.js) — otherwise a margin sized for the big poster can exceed
// half a small panel's width/height, clamping its guide to 0 for a whole
// range of edits and looking "stuck" once you switch sides.
function marginKey() {
  return state.side === 'back' ? 'backMargin' : 'frontMargin';
}

function initSheetSetup() {
  document.getElementById('paperPresetSelect').addEventListener('change', (e) => {
    commit((project) => {
      project.paperPreset = e.target.value;
      project.pageSize = pageSizeForPreset(project.paperPreset, project.pageSize.dpi);
    });
  });

  document.getElementById('unitSelect').addEventListener('change', (e) => {
    unit = e.target.value;
    localStorage.setItem('zine-unit', unit);
    syncSheetSetupInputs();
  });

  bindLiveField(document.getElementById('marginInput'), 'input', (v) => {
    const dpi = state.project.pageSize.dpi;
    state.project[marginKey()] = Math.max(0, unitToPx(Number(v) || 0, unit, dpi));
  });
}

function syncSheetSetupInputs() {
  const project = state.project;
  const { dpi } = project.pageSize;
  document.getElementById('zineTitleInput').value = project.title;
  document.getElementById('paperPresetSelect').value = project.paperPreset;

  const unitSelect = document.getElementById('unitSelect');
  if (document.activeElement !== unitSelect) unitSelect.value = unit;

  document.getElementById('marginLabelText').textContent = `Safe-margin guide (${state.side === 'back' ? 'back' : 'front'})`;
  const marginInput = document.getElementById('marginInput');
  marginInput.step = unitStep(unit);
  if (document.activeElement !== marginInput) marginInput.value = formatForUnit(project[marginKey()], unit, dpi);

  const template = getTemplate(project.templateId);
  document.getElementById('templateSelect').value = project.templateId;
  document.getElementById('templateDescription').textContent = template.description;
}

// ---- Front/back + panel list ----

function initSideControls() {
  document.getElementById('sideFrontBtn').addEventListener('click', () => setSide('front'));
  document.getElementById('sideBackBtn').addEventListener('click', () => setSide('back'));
}

function sideButtonLabel(template, side) {
  const name = side === 'back' ? 'Back' : 'Front';
  if (isPosterSide(template, side)) return `${name} (poster)`;
  const { columns, rows } = getSideGrid(template, side);
  return `${name} (${columns * rows} panels)`;
}

function renderSideControls() {
  const template = getTemplate(state.project.templateId);
  const frontBtn = document.getElementById('sideFrontBtn');
  const backBtn = document.getElementById('sideBackBtn');
  frontBtn.textContent = sideButtonLabel(template, 'front');
  backBtn.textContent = sideButtonLabel(template, 'back');
  frontBtn.classList.toggle('active', state.side === 'front');
  backBtn.classList.toggle('active', state.side === 'back');

  const list = document.getElementById('panelList');
  list.innerHTML = '';
  if (isPosterSide(template, state.side)) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  const panels = getSidePanels(template, state.side);
  const rowNumbers = [...new Set(panels.map((p) => p.row))].sort((a, b) => a - b);
  for (const row of rowNumbers) {
    const rowEl = document.createElement('div');
    rowEl.className = 'panel-list-row';
    for (const panelDef of panels.filter((p) => p.row === row).sort((a, b) => a.col - b.col)) {
      const item = document.createElement('div');
      item.className = 'panel-list-item';
      if (panelDef.id === state.activePanelId) item.classList.add('active');
      // Rotating the whole label 90/270 via CSS transform paints outside
      // its own grid cell (transforms don't reflow layout, so a rotated
      // short-and-wide box overlaps the row above/below) — only 180 is
      // safe to rotate in place since it doesn't swap the box's
      // dimensions. 90/270 get a small icon instead.
      if (panelDef.rotate === 180) item.classList.add('upside-down');
      else if (panelDef.rotate === 90) item.classList.add('rotated-cw');
      else if (panelDef.rotate === 270) item.classList.add('rotated-ccw');
      item.textContent = panelDef.label;
      item.title = panelDef.rotate ? `${panelDef.label} — prints rotated ${panelDef.rotate}° on this sheet (use the spin controls to edit it comfortably)` : panelDef.label;
      item.addEventListener('click', () => {
        state.activePanelId = panelDef.id;
        selectObject(null, null, null);
      });
      rowEl.appendChild(item);
    }
    list.appendChild(rowEl);
  }
}

// ---- Palette (add objects) ----

function addObjectToActivePanel(obj) {
  const panel = getActivePanelData();
  if (!panel) return;
  commit(() => { panel.objects.push(obj); });
  const template = getTemplate(state.project.templateId);
  const panelId = isPosterSide(template, state.side) ? state.side : state.activePanelId;
  selectObject(state.side, panelId, obj.id);
}

function scaledImageSize(img, maxW, maxH) {
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  return { w: Math.round(img.naturalWidth * ratio), h: Math.round(img.naturalHeight * ratio) };
}

function activePanelPixelSize() {
  const { widthPx, heightPx } = state.project.pageSize;
  const template = getTemplate(state.project.templateId);
  if (isPosterSide(template, state.side)) return { w: widthPx, h: heightPx };
  const grid = getSideGrid(template, state.side);
  const panelW = widthPx / grid.columns;
  const panelH = heightPx / grid.rows;
  // A 90/270 panel's own authoring space is swapped (see canvas.js's
  // contentSize) — match that here so a newly-added image is scaled
  // against the panel's actual content box, not its unrotated cell.
  const panelDef = getSidePanels(template, state.side).find((p) => p.id === state.activePanelId);
  const swapped = panelDef && panelDef.rotate % 180 !== 0;
  return swapped ? { w: panelH, h: panelW } : { w: panelW, h: panelH };
}

function initPalette() {
  document.querySelectorAll('#palette [data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      if (kind === 'text') addObjectToActivePanel(newTextObject());
      else if (kind === 'image') document.getElementById('imageFileInput').click();
    });
  });

  document.getElementById('imageFileInput').addEventListener('change', (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    const url = registerAsset(file, file.name);
    const img = new Image();
    img.onload = () => {
      const { w: panelW, h: panelH } = activePanelPixelSize();
      const { w, h } = scaledImageSize(img, panelW * 0.8, panelH * 0.8);
      addObjectToActivePanel(newImageObject({ src: url, alt: file.name, w, h }));
    };
    img.src = url;
    input.value = '';
  });
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

function fontSizeInput(obj) {
  const { dpi } = state.project.pageSize;
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

let lastRenderedObjId = null;

function getSelectedPanelAndObject() {
  if (!state.selection) return {};
  const objects = getPanelObjects(state.selection.side, state.selection.panelId);
  const obj = objects && objects.find((o) => o.id === state.selection.objectId);
  return { objects, obj };
}

function renderProperties() {
  const panelEl = document.getElementById('propertiesPanel');
  const { objects, obj } = getSelectedPanelAndObject();

  const active = document.activeElement;
  const focusedFieldInPanel = panelEl.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (obj && focusedFieldInPanel && lastRenderedObjId === obj.id) return;
  lastRenderedObjId = obj ? obj.id : null;

  panelEl.innerHTML = '';
  if (!obj) {
    panelEl.innerHTML = '<p class="hint">Select an object to edit it.</p>';
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
  panelEl.appendChild(grid);

  const lockRow = document.createElement('label');
  lockRow.className = 'row';
  const lockCheckbox = document.createElement('input');
  lockCheckbox.type = 'checkbox';
  lockCheckbox.checked = obj.lockRatio;
  lockCheckbox.addEventListener('change', () => commit(() => { obj.lockRatio = lockCheckbox.checked; }));
  lockRow.appendChild(lockCheckbox);
  lockRow.appendChild(document.createTextNode(' Lock ratio (or hold Shift while resizing)'));
  panelEl.appendChild(lockRow);

  panelEl.appendChild(field('Rotation (deg)', numberInput(obj.rot, (v) => { obj.rot = v; })));

  if (obj.type === 'text') {
    const textarea = document.createElement('textarea');
    textarea.value = obj.content;
    bindLiveField(textarea, 'input', (v) => { obj.content = v; });
    panelEl.appendChild(field('Text', textarea));

    const fontInput = document.createElement('input');
    fontInput.type = 'text';
    fontInput.value = obj.fontFamily;
    bindLiveField(fontInput, 'input', (v) => { obj.fontFamily = v || obj.fontFamily; });
    panelEl.appendChild(field('Font', fontInput));

    panelEl.appendChild(field('Font size (pt)', fontSizeInput(obj)));

    const color = document.createElement('input');
    color.type = 'color';
    color.value = obj.color;
    bindLiveField(color, 'input', (v) => { obj.color = v; });
    panelEl.appendChild(field('Color', color));

    const align = document.createElement('select');
    ['left', 'center', 'right'].forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      if (a === obj.align) opt.selected = true;
      align.appendChild(opt);
    });
    align.addEventListener('change', () => commit(() => { obj.align = align.value; }));
    panelEl.appendChild(field('Align', align));
  }

  if (obj.type === 'image') {
    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace Image…';
    replaceBtn.className = 'block';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    replaceBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const url = registerAsset(file, file.name);
      commit(() => { obj.src = url; });
    });
    panelEl.appendChild(field('Image', replaceBtn));
    panelEl.appendChild(fileInput);

    const alt = document.createElement('input');
    alt.type = 'text';
    alt.value = obj.alt || '';
    bindLiveField(alt, 'input', (v) => { obj.alt = v; });
    panelEl.appendChild(field('Alt text', alt));
  }

  const layerRow = document.createElement('div');
  layerRow.className = 'row';
  const front = document.createElement('button');
  front.textContent = 'Bring to front';
  front.addEventListener('click', () => commit(() => {
    const maxZ = Math.max(0, ...objects.map((o) => o.z));
    obj.z = maxZ + 1;
  }));
  const back = document.createElement('button');
  back.textContent = 'Send to back';
  back.addEventListener('click', () => commit(() => {
    const minZ = Math.min(0, ...objects.map((o) => o.z));
    obj.z = minZ - 1;
  }));
  layerRow.appendChild(front);
  layerRow.appendChild(back);
  panelEl.appendChild(layerRow);

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete object';
  deleteBtn.className = 'danger';
  deleteBtn.addEventListener('click', deleteSelectedObject);
  panelEl.appendChild(deleteBtn);
}

export function deleteSelectedObject() {
  if (!state.selection) return;
  const objects = getPanelObjects(state.selection.side, state.selection.panelId);
  const obj = objects && objects.find((o) => o.id === state.selection.objectId);
  if (!objects || !obj) return;
  commit(() => {
    const i = objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) objects.splice(i, 1);
  });
  selectObject(null, null, null);
}

// ---- Public API ----

export function initPanels() {
  initTitle();
  initTemplateControls();
  initSheetSetup();
  initSideControls();
  initPalette();
}

export function renderPanels() {
  syncSheetSetupInputs();
  renderSideControls();
  renderProperties();
}
