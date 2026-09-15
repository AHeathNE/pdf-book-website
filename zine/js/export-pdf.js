// Exports a 2-page, print-ready PDF sized to the real sheet: one page per
// side. A poster side renders as one full-sheet canvas; a panel-grid side
// renders each panel individually, unrotated, in its own (possibly
// axis-swapped — see contentSize) authoring space, then composites each
// onto the sheet at its template-baked rotation, so what prints is the
// true, unspun sheet regardless of the on-screen view-spin. Mirrors
// editor/js/export-pdf.js's html2canvas + jsPDF approach, including its
// "rasterize unrotated, composite with native Canvas2D rotate" trick for
// rotated content — applied per panel here (and still per rotated object
// within a panel), since html2canvas itself mishandles rotated elements
// (shears them; confirmed against a real exported PDF), while the
// browser's own Canvas2D rotation is reliable.
import { renderPage } from '../../shared/renderer.js';
import { state } from './store.js';
import {
  getTemplate, isPosterSide, getSideGrid, getSidePanels, getSideCutLine,
} from './templates.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

async function renderRotatedObjectCanvas(obj) {
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = `${obj.w}px`;
  holder.style.height = `${obj.h}px`;
  document.body.appendChild(holder);
  try {
    const unrotated = { ...obj, x: 0, y: 0, rot: 0 };
    renderPage({ background: null, objects: [unrotated] }, holder, { editable: false });
    return await html2canvas(holder, {
      width: obj.w, height: obj.h, scale: 1, useCORS: true, backgroundColor: null,
    });
  } finally {
    holder.remove();
  }
}

// Renders one panel's own objects (in its local, unrotated authoring
// space) to a canvas sized exactly to that panel's content box.
async function renderPanelCanvas(panelData, contentW, contentH) {
  const offscreen = document.createElement('div');
  offscreen.style.position = 'fixed';
  offscreen.style.left = '-99999px';
  offscreen.style.top = '0';
  offscreen.style.width = `${contentW}px`;
  offscreen.style.height = `${contentH}px`;
  document.body.appendChild(offscreen);

  try {
    const rotatedObjects = panelData.objects.filter((o) => o.rot);
    const baseObjects = panelData.objects.filter((o) => !o.rot);

    renderPage({ objects: baseObjects, background: null }, offscreen, { editable: false });
    const baseCanvas = await html2canvas(offscreen, {
      width: contentW, height: contentH, scale: 1, useCORS: true, backgroundColor: '#ffffff',
    });

    const canvas = document.createElement('canvas');
    canvas.width = contentW;
    canvas.height = contentH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, contentW, contentH);
    ctx.drawImage(baseCanvas, 0, 0);

    for (const obj of rotatedObjects) {
      // eslint-disable-next-line no-await-in-loop
      const objCanvas = await renderRotatedObjectCanvas(obj);
      ctx.save();
      ctx.translate(obj.x + obj.w / 2, obj.y + obj.h / 2);
      ctx.rotate((obj.rot * Math.PI) / 180);
      ctx.drawImage(objCanvas, -obj.w / 2, -obj.h / 2, obj.w, obj.h);
      ctx.restore();
    }
    return canvas;
  } finally {
    offscreen.remove();
  }
}

// A 90/270 panel's authoring space is swapped (contentW x contentH is
// panelH x panelW) so that rotating it lands back on the panelW x panelH
// cell — see canvas.js's identical contentSize/buildPanel.
function contentSize(rotateDeg, panelW, panelH) {
  return (rotateDeg % 180 !== 0) ? { w: panelH, h: panelW } : { w: panelW, h: panelH };
}

async function buildGridCanvas(project, template, side) {
  const { widthPx, heightPx } = project.pageSize;
  const grid = getSideGrid(template, side);
  const panelW = widthPx / grid.columns;
  const panelH = heightPx / grid.rows;

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = widthPx;
  sheetCanvas.height = heightPx;
  const ctx = sheetCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  for (const panelDef of getSidePanels(template, side)) {
    const panelData = project[side][panelDef.id];
    setStatus(`Exporting PDF — ${side}, ${panelDef.label}…`);
    const { w: contentW, h: contentH } = contentSize(panelDef.rotate, panelW, panelH);
    // eslint-disable-next-line no-await-in-loop
    const panelCanvas = await renderPanelCanvas(panelData, contentW, contentH);
    const cx = panelDef.col * panelW + panelW / 2;
    const cy = panelDef.row * panelH + panelH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (panelDef.rotate) ctx.rotate((panelDef.rotate * Math.PI) / 180);
    ctx.drawImage(panelCanvas, -contentW / 2, -contentH / 2, contentW, contentH);
    ctx.restore();
  }
  return sheetCanvas;
}

async function buildPosterCanvas(project, side) {
  const { widthPx, heightPx } = project.pageSize;
  setStatus(`Exporting PDF — ${side} sheet…`);
  return renderPanelCanvas(project[side], widthPx, heightPx);
}

async function buildSideCanvas(project, template, side) {
  return isPosterSide(template, side)
    ? buildPosterCanvas(project, side)
    : buildGridCanvas(project, template, side);
}

export async function exportPdf() {
  const { project } = state;
  const template = getTemplate(project.templateId);
  const {
    widthPx, heightPx, dpi,
  } = project.pageSize;
  const wPt = (widthPx * 72) / dpi;
  const hPt = (heightPx * 72) / dpi;
  const orientation = wPt >= hPt ? 'landscape' : 'portrait';

  const { jsPDF } = window.jspdf;

  const frontCanvas = await buildSideCanvas(project, template, 'front');
  const doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation });
  doc.addImage(frontCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wPt, hPt);

  const backCanvas = await buildSideCanvas(project, template, 'back');
  doc.addPage([wPt, hPt], orientation);
  doc.addImage(backCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wPt, hPt);

  const name = (project.title || 'zine').replace(/[^a-zA-Z0-9_.-]/g, '_');
  doc.save(`${name}.pdf`);
  const anyCut = getSideCutLine(template, 'front') || getSideCutLine(template, 'back');
  const backIsPoster = isPosterSide(template, 'back');
  const foldStep = anyCut ? 'fold + cut' : 'fold';
  const backDescription = backIsPoster ? 'back poster' : 'back sheet';
  setStatus(`PDF exported — page 1 is the front sheet (print, then ${foldStep}), page 2 is the ${backDescription}.`);
}
