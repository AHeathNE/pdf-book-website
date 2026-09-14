// Zine template registry. Each template describes how one flat printable
// sheet divides into panels for the front side (a grid, each panel
// carrying a fixed baked `rotate` so its content reads correctly once the
// sheet is folded), a cut-line guide, and the back side (currently always
// a single full-bleed poster panel — no grid, no cut, no baked rotation).
//
// The punk-8up panel numbering/rotation below matches the reference
// layout the sheet is built from exactly:
//
//   Row 0 (top,    baked 180deg): Page 4 | Page 3 | Page 2 | Page 1
//   Row 1 (bottom, baked   0deg): Page 5 | Page 6 | Back Cover | Front Cover
//
// which zigzags correctly in physical reading order: Front Cover -> Page 1
// -> Page 2 -> Page 3 -> Page 4 -> Page 5 -> Page 6 -> Back Cover. The cut
// is a horizontal slit at the row boundary spanning only the middle two
// columns — the outer two columns stay hinged so the sheet doesn't split
// into two pieces.
export const TEMPLATES = {
  'punk-8up': {
    id: 'punk-8up',
    name: '8-Panel Punk Zine (one sheet, one cut)',
    description: 'Front sheet has 8 panels; cut a slit across the middle two columns after printing, then fold. Back is one full-sheet poster.',
    grid: { columns: 4, rows: 2 },
    orientation: 'landscape',
    panels: [
      { id: 'page-4', label: 'Page 4', row: 0, col: 0, rotate: 180 },
      { id: 'page-3', label: 'Page 3', row: 0, col: 1, rotate: 180 },
      { id: 'page-2', label: 'Page 2', row: 0, col: 2, rotate: 180 },
      { id: 'page-1', label: 'Page 1', row: 0, col: 3, rotate: 180 },
      { id: 'page-5', label: 'Page 5', row: 1, col: 0, rotate: 0 },
      { id: 'page-6', label: 'Page 6', row: 1, col: 1, rotate: 0 },
      { id: 'back-cover', label: 'Back Cover', row: 1, col: 2, rotate: 0 },
      { id: 'front-cover', label: 'Front Cover', row: 1, col: 3, rotate: 0 },
    ],
    // Fractions of the full sheet's width/height — a horizontal slit at
    // the row boundary, spanning only the middle two columns.
    cutLine: {
      y: 0.5, x1: 0.25, x2: 0.75,
    },
    back: { poster: true },
  },
  // A different fold (no cutting at all) with covers on the outer
  // columns instead of the middle, and Pages 5/6 in the middle instead
  // of Pages 1/2 — per the user-supplied reference sketch:
  //
  //   Row 0 (top,    baked 180deg): Page 4 | Page 3 | Page 2 | Page 1
  //   Row 1 (bottom, baked   0deg): Back Cover | Page 5 | Page 6 | Front Cover
  //
  // Unlike punk-8up, physical adjacency on the flat sheet does NOT trace
  // the reading order in a simple zigzag here — that's expected, it's a
  // genuinely different fold mechanism, not a variant of the cut-zine's.
  'no-cut-8up': {
    id: 'no-cut-8up',
    name: '8-Panel No-Cut Zine (fold only)',
    description: 'Front sheet has 8 panels; fold only, no cutting. Back is one full-sheet poster.',
    grid: { columns: 4, rows: 2 },
    orientation: 'landscape',
    panels: [
      { id: 'page-4', label: 'Page 4', row: 0, col: 0, rotate: 180 },
      { id: 'page-3', label: 'Page 3', row: 0, col: 1, rotate: 180 },
      { id: 'page-2', label: 'Page 2', row: 0, col: 2, rotate: 180 },
      { id: 'page-1', label: 'Page 1', row: 0, col: 3, rotate: 180 },
      { id: 'back-cover', label: 'Back Cover', row: 1, col: 0, rotate: 0 },
      { id: 'page-5', label: 'Page 5', row: 1, col: 1, rotate: 0 },
      { id: 'page-6', label: 'Page 6', row: 1, col: 2, rotate: 0 },
      { id: 'front-cover', label: 'Front Cover', row: 1, col: 3, rotate: 0 },
    ],
    cutLine: null,
    back: { poster: true },
  },
};

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['punk-8up'];
}

export function getPanel(template, panelId) {
  return template.panels.find((p) => p.id === panelId) || null;
}

// Panels sharing a row always share the same baked rotation (see the
// table above), which is what makes same-row neighbor dragging in
// canvas.js a plain coordinate rebase rather than a re-flip.
export function getRowPanels(template, row) {
  return template.panels.filter((p) => p.row === row).sort((a, b) => a.col - b.col);
}
