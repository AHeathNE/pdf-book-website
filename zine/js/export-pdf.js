// Exports a 2-page, print-ready PDF sized to the real sheet: page 1 is the
// front (8 panels, each individually rasterized unrotated then composited
// back onto the sheet at its template-baked rotation, so what prints is
// the true, unspun sheet regardless of the on-screen view-spin), page 2 is
// the back poster. Mirrors editor/js/export-pdf.js's html2canvas + jsPDF
// approach, including its "rasterize unrotated, composite with native
// Canvas2D rotate" trick for rotated content — applied per panel here
// (and still per rotated object within a panel), since html2canvas itself
// mishandles rotated elements (shears them; confirmed against a real
// exported PDF), while the browser's own Canvas2D rotation is reliable.
import { renderPage } from '../../shared/renderer.js';
import { state } from './store.js';
import { getTemplate } from './templates.js';

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
// space) to a canvas sized exactly to that panel.
async function renderPanelCanvas(panelData, panelW, panelH) {
  const offscreen = document.createElement('div');
  offscreen.style.position = 'fixed';
  offscreen.style.left = '-99999px';
  offscreen.style.top = '0';
  offscreen.style.width = `${panelW}px`;
  offscreen.style.height = `${panelH}px`;
  document.body.appendChild(offscreen);

  try {
    const rotatedObjects = panelData.objects.filter((o) => o.rot);
    const baseObjects = panelData.objects.filter((o) => !o.rot);

    renderPage({ objects: baseObjects, background: null }, offscreen, { editable: false });
    const baseCanvas = await html2canvas(offscreen, {
      width: panelW, height: panelH, scale: 1, useCORS: true, backgroundColor: '#ffffff',
    });

    const canvas = document.createElement('canvas');
    canvas.width = panelW;
    canvas.height = panelH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, panelW, panelH);
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

async function buildFrontCanvas(project, template) {
  const { widthPx, heightPx } = project.pageSize;
  const panelW = widthPx / template.grid.columns;
  const panelH = heightPx / template.grid.rows;

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = widthPx;
  sheetCanvas.height = heightPx;
  const ctx = sheetCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  for (const panelDef of template.panels) {
    const panelData = project.front[panelDef.id];
    setStatus(`Exporting PDF — front, ${panelDef.label}…`);
    // eslint-disable-next-line no-await-in-loop
    const panelCanvas = await renderPanelCanvas(panelData, panelW, panelH);
    const cx = panelDef.col * panelW + panelW / 2;
    const cy = panelDef.row * panelH + panelH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (panelDef.rotate) ctx.rotate((panelDef.rotate * Math.PI) / 180);
    ctx.drawImage(panelCanvas, -panelW / 2, -panelH / 2, panelW, panelH);
    ctx.restore();
  }
  return sheetCanvas;
}

async function buildBackCanvas(project) {
  const { widthPx, heightPx } = project.pageSize;
  return renderPanelCanvas(project.back, widthPx, heightPx);
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

  setStatus('Exporting PDF — front sheet…');
  const frontCanvas = await buildFrontCanvas(project, template);
  const doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation });
  doc.addImage(frontCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wPt, hPt);

  setStatus('Exporting PDF — back sheet…');
  const backCanvas = await buildBackCanvas(project);
  doc.addPage([wPt, hPt], orientation);
  doc.addImage(backCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, wPt, hPt);

  const name = (project.title || 'zine').replace(/[^a-zA-Z0-9_.-]/g, '_');
  doc.save(`${name}.pdf`);
  const foldStep = template.cutLine ? 'fold + cut' : 'fold';
  setStatus(`PDF exported — page 1 is the front sheet (print, then ${foldStep}), page 2 is the back poster.`);
}
