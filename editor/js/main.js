import { newBook } from '../../shared/schema.js';
import { state, subscribe, notify, loadBook, undo, redo, isTextEditingTarget } from './store.js';
import {
  renderCanvas, initZoomControls, zoomIn, zoomOut, zoomReset,
} from './canvas.js';
import { initPanels, renderPanels, getActivePage, deleteSelectedObject } from './panels.js';
import { autosaveDebounced, restoreFromIndexedDb, saveProjectZip, openProjectZip } from './storage.js';
import { importPdf } from './pdf-import.js';
import { exportPdf } from './export-pdf.js';
import { exportWebsite } from './export-website.js';
import { wireClipboardShortcuts } from './clipboard.js';

function setStatus(text) {
  document.getElementById('statusText').textContent = text;
}

function wireToolbar() {
  document.getElementById('newProjectBtn').addEventListener('click', () => {
    if (window.confirm('Start a new book? Unsaved changes in the current project will be lost.')) {
      loadBook(newBook());
    }
  });

  const openInput = document.getElementById('openProjectInput');
  document.getElementById('openProjectBtn').addEventListener('click', () => openInput.click());
  openInput.addEventListener('change', async () => {
    const file = openInput.files[0];
    openInput.value = '';
    if (!file) return;
    try {
      setStatus('Opening project…');
      await openProjectZip(file);
      setStatus('Project opened.');
    } catch (err) {
      console.error(err);
      setStatus(`Failed to open project: ${err.message}`);
    }
  });

  document.getElementById('saveProjectBtn').addEventListener('click', async () => {
    try {
      setStatus('Saving project…');
      await saveProjectZip();
      setStatus('Project saved.');
    } catch (err) {
      console.error(err);
      setStatus(`Failed to save project: ${err.message}`);
    }
  });

  const pdfInput = document.getElementById('importPdfInput');
  document.getElementById('importPdfBtn').addEventListener('click', () => pdfInput.click());
  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files[0];
    pdfInput.value = '';
    if (!file) return;
    try {
      await importPdf(file);
    } catch (err) {
      console.error(err);
      setStatus(`Failed to import PDF: ${err.message}`);
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

  document.getElementById('exportWebsiteBtn').addEventListener('click', async () => {
    try {
      await exportWebsite();
    } catch (err) {
      console.error(err);
      setStatus(`Failed to export website: ${err.message}`);
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

  wireClipboardShortcuts(getActivePage);
}

async function main() {
  initPanels();
  initZoomControls();
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
