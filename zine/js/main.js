import { newZineProject } from './schema.js';
import {
  state, subscribe, notify, loadProject, undo, redo, isTextEditingTarget,
} from './store.js';
import {
  renderCanvas, initZoomControls, zoomIn, zoomOut, zoomReset,
} from './canvas.js';
import { initPanels, renderPanels, deleteSelectedObject } from './panels.js';
import { initSpinControls, initGuidesToggle } from './view.js';
import { autosaveDebounced, restoreFromIndexedDb } from './storage.js';
import { exportPdf } from './export-pdf.js';

function setStatus(text) {
  document.getElementById('statusText').textContent = text;
}

function wireToolbar() {
  document.getElementById('newProjectBtn').addEventListener('click', () => {
    if (window.confirm('Start a new zine? Unsaved changes in the current project will be lost.')) {
      loadProject(newZineProject());
    }
  });

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  document.getElementById('exportPdfBtn').addEventListener('click', async () => {
    try {
      await exportPdf();
    } catch (err) {
      console.error(err);
      setStatus(`Failed to export PDF: ${err.message}`);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (isTextEditingTarget()) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) {
      e.preventDefault();
      deleteSelectedObject();
      return;
    }

    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;
    if (e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
    else if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-') { e.preventDefault(); zoomOut(); }
    else if (e.key === '0') { e.preventDefault(); zoomReset(); }
  });
}

async function main() {
  initPanels();
  initZoomControls();
  initSpinControls();
  initGuidesToggle();
  wireToolbar();
  subscribe(() => {
    renderCanvas();
    renderPanels();
    autosaveDebounced();
  });

  let restored = false;
  try {
    restored = await restoreFromIndexedDb();
  } catch (err) {
    console.error('Failed to restore autosaved project', err);
  }
  if (restored) setStatus('Restored your autosaved project.');
  else notify();
}

main();
