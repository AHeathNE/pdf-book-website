// Exports a blank, printable reference sheet for the CURRENT template:
// the same grid lines, cut-line, per-panel safe-margin box, and panel
// labels shown on screen (see canvas.js's drawGridOverlay/buildPanel),
// but as an actual print-ready PDF, using the project's own margin
// values and paper size — no user content. Handy as a fold-and-cut
// cheat sheet, or to hand someone else the blank layout for a style.
//
// Unlike export-pdf.js, this draws with jsPDF's own vector primitives
// (rect/line/text) rather than rasterizing via html2canvas — there's no
// user content to reproduce pixel-for-pixel here, just simple geometry
// and short labels, and vector output stays crisp at any print size.
import { state } from './store.js';
import {
  getTemplate, isPosterSide, getSideGrid, getSidePanels, getSideCutLine,
} from './templates.js';

function pxToPt(px, dpi) {
  return (px * 72) / dpi;
}

function marginFor(project, side) {
  return side === 'back' ? project.backMargin : project.frontMargin;
}

function drawPosterGuide(doc, project, side, wPt, hPt, dpi) {
  const marginPt = pxToPt(marginFor(project, side), dpi);

  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(1);
  doc.rect(0, 0, wPt, hPt);

  doc.setDrawColor(80, 140, 255);
  doc.setLineWidth(0.75);
  doc.setLineDashPattern([3, 2], 0);
  doc.rect(marginPt, marginPt, wPt - 2 * marginPt, hPt - 2 * marginPt);
  doc.setLineDashPattern([], 0);

  doc.setFontSize(10);
  doc.setTextColor(70, 70, 70);
  doc.text('Poster', 6, 13);
}

function drawGridGuide(doc, project, template, side, wPt, hPt, dpi) {
  const grid = getSideGrid(template, side);
  const panels = getSidePanels(template, side);
  const marginPt = pxToPt(marginFor(project, side), dpi);
  const panelWpt = wPt / grid.columns;
  const panelHpt = hPt / grid.rows;

  doc.setDrawColor(140, 140, 140);
  doc.setLineWidth(1);
  doc.rect(0, 0, wPt, hPt);

  doc.setLineWidth(0.5);
  for (let c = 1; c < grid.columns; c += 1) {
    const x = panelWpt * c;
    doc.line(x, 0, x, hPt);
  }
  for (let r = 1; r < grid.rows; r += 1) {
    const y = panelHpt * r;
    doc.line(0, y, wPt, y);
  }

  doc.setDrawColor(80, 140, 255);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([2, 1.5], 0);
  for (const panelDef of panels) {
    const x0 = panelDef.col * panelWpt;
    const y0 = panelDef.row * panelHpt;
    doc.rect(x0 + marginPt, y0 + marginPt, panelWpt - 2 * marginPt, panelHpt - 2 * marginPt);
  }
  doc.setLineDashPattern([], 0);

  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  for (const panelDef of panels) {
    const x0 = panelDef.col * panelWpt;
    const y0 = panelDef.row * panelHpt;
    // jsPDF rotates text counter-clockwise for a positive angle; our
    // template's `rotate` is the CSS clockwise convention (see
    // templates.js), so negate it to match.
    const angle = -panelDef.rotate;

    // jsPDF rotates text around the given anchor point (the start of its
    // baseline) and draws it advancing from there — not in place around
    // a box like the on-screen CSS label — so a rotated run can swing
    // past the panel's edge, or even the page's, unless the anchor is
    // shifted to compensate:
    //  - 0/90 already read "into" the panel from a top-left anchor (right
    //    and down), so they need no correction.
    //  - 180 reads leftward/upward from the anchor, which for a col-0
    //    panel goes past the PAGE's left edge — anchoring at
    //    "top-left + this text's own width" instead keeps the run inside
    //    the usual top-left area.
    //  - 270 reads upward from the anchor (see templates.js: 270 = tilt
    //    head left), which for row-0 goes past the page's TOP edge —
    //    anchoring "top-left + this text's own width", but on the y axis
    //    this time, keeps it on the page the same way.
    if (panelDef.rotate === 180) {
      const textW = doc.getTextWidth(panelDef.label);
      doc.text(panelDef.label, x0 + 6 + textW, y0 + 13, { angle });
    } else if (panelDef.rotate === 270) {
      const textW = doc.getTextWidth(panelDef.label);
      doc.text(panelDef.label, x0 + 13, y0 + 6 + textW, { angle });
    } else {
      doc.text(panelDef.label, x0 + 6, y0 + 13, { angle });
    }
  }

  const cutLine = getSideCutLine(template, side);
  if (cutLine) {
    doc.setDrawColor(217, 54, 62);
    doc.setLineWidth(1.25);
    doc.setLineDashPattern([5, 3], 0);
    const y = hPt * cutLine.y;
    doc.line(wPt * cutLine.x1, y, wPt * cutLine.x2, y);
    doc.setLineDashPattern([], 0);
  }
}

export async function exportTemplateGuide() {
  const { project } = state;
  const template = getTemplate(project.templateId);
  const {
    widthPx, heightPx, dpi,
  } = project.pageSize;
  const wPt = pxToPt(widthPx, dpi);
  const hPt = pxToPt(heightPx, dpi);
  const orientation = wPt >= hPt ? 'landscape' : 'portrait';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation });

  const sides = ['front', 'back'];
  sides.forEach((side, i) => {
    if (i > 0) doc.addPage([wPt, hPt], orientation);
    if (isPosterSide(template, side)) drawPosterGuide(doc, project, side, wPt, hPt, dpi);
    else drawGridGuide(doc, project, template, side, wPt, hPt, dpi);
  });

  const name = template.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  doc.save(`${name}_guide.pdf`);
}
