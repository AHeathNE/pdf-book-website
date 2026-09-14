import { newTextObject, newImageObject } from '../../shared/schema.js';
import { pageSizeForPreset } from './schema.js';
import { getTemplate } from './templates.js';
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

// ---- Sheet setup (paper size, margin) ----

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
    state.project.margin = Math.max(0, unitToPx(Number(v) || 0, unit, dpi));
  });
}

function syncSheetSetupInputs() {
  const project = state.project;
  const { dpi } = project.pageSize;
  document.getElementById('zineTitleInput').value = project.title;
  document.getElementById('paperPresetSelect').value = project.paperPreset;

  const unitSelect = document.getElementById('unitSelect');
  if (document.activeElement !== unitSelect) unitSelect.value = unit;

  const marginInput = document.getElementById('marginInput');
  marginInput.step = unitStep(unit);
  if (document.activeElement !== marginInput) marginInput.value = formatForUnit(project.margin, unit, dpi);

  const template = getTemplate(project.templateId);
  document.getElementById('templateName').textContent = template.name;
}

// ---- Front/back + panel list ----

function initSideControls() {
  document.getElementById('sideFrontBtn').addEventListener('click', () => setSide('front'));
  document.getElementById('sideBackBtn').addEventListener('click', () => setSide('back'));
}

function renderSideControls() {
  document.getElementById('sideFrontBtn').classList.toggle('active', state.side === 'front');
  document.getElementById('sideBackBtn').classList.toggle('active', state.side === 'back');

  const list = document.getElementById('panelList');
  list.innerHTML = '';
  if (state.side !== 'front') {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  const template = getTemplate(state.project.templateId);
  const byRow = [0, 1].map((row) => template.panels.filter((p) => p.row === row).sort((a, b) => a.col - b.col));
  for (const row of byRow) {
    const rowEl = document.createElement('div');
    rowEl.className = 'panel-list-row';
    for (const panelDef of row) {
      const item = document.createElement('div');
      item.className = 'panel-list-item';
      if (panelDef.id === state.activePanelId) item.classList.add('active');
      if (panelDef.rotate) item.classList.add('upside-down');
      item.textContent = panelDef.label;
      item.title = panelDef.rotate ? `${panelDef.label} — prints upside-down on this sheet (flip the view to edit it comfortably)` : panelDef.label;
      item.addEventListener('click', () => {
        state.activePanelId = panelDef.id;
        selectObject(null, null);
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
  selectObject(state.side === 'back' ? 'back' : state.activePanelId, obj.id);
}

function scaledImageSize(img, maxW, maxH) {
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  return { w: Math.round(img.naturalWidth * ratio), h: Math.round(img.naturalHeight * ratio) };
}

function activePanelPixelSize() {
  const { widthPx, heightPx } = state.project.pageSize;
  if (state.side === 'back') return { w: widthPx, h: heightPx };
  const template = getTemplate(state.project.templateId);
  return { w: widthPx / template.grid.columns, h: heightPx / template.grid.rows };
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
  const objects = getPanelObjects(state.selection.panelId);
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
  const objects = getPanelObjects(state.selection.panelId);
  const obj = objects && objects.find((o) => o.id === state.selection.objectId);
  if (!objects || !obj) return;
  commit(() => {
    const i = objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) objects.splice(i, 1);
  });
  selectObject(null, null);
}

// ---- Public API ----

export function initPanels() {
  initTitle();
  initSheetSetup();
  initSideControls();
  initPalette();
}

export function renderPanels() {
  syncSheetSetupInputs();
  renderSideControls();
  renderProperties();
}
