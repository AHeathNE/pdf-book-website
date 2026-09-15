// Zine template registry. Each side (front/back) of a template is either
// a single full-bleed poster ({ poster: true }) or a panel grid ({ grid,
// panels, cutLine }) — most templates only need panels on the front, but
// a template can have a real cut/fold grid on both sides (see
// 'pants-16up' below), so neither side is special-cased in the rest of
// the app; see getSideConfig/isPosterSide/etc. below.
//
// A panel's `rotate` (0/90/180/270) is the CSS-clockwise rotation baked
// into that panel's print orientation on the flat, unfolded sheet, so
// that once the sheet is physically folded (and cut, where applicable)
// the panel reads upright in the assembled booklet. It has nothing to do
// with the on-screen view-spin control (view.js), which is a pure
// editing convenience layered on top and never affects what's exported.
//
// The punk-8up panel numbering/rotation matches its reference layout
// exactly:
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
    orientation: 'landscape',
    front: {
      grid: { columns: 4, rows: 2 },
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
      // Fractions of the full sheet's width/height — a horizontal slit
      // at the row boundary, spanning only the middle two columns.
      cutLine: { y: 0.5, x1: 0.25, x2: 0.75 },
    },
    back: { poster: true },
  },
  // A different fold (no cutting at all) with covers on the outer
  // columns instead of the middle, and Pages 5/6 in the middle instead
  // of Pages 1/2:
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
    orientation: 'landscape',
    front: {
      grid: { columns: 4, rows: 2 },
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
    },
    back: { poster: true },
  },
  // A 16-page zine from one two-sided sheet, read in PORTRAIT (the sheet
  // itself stays landscape — the book is turned 90deg to read). Both
  // sides are cut/fold grids sharing the same physical cut (a horizontal
  // slit spanning 3/4 of the width, centered, so 1/8 stays hinged on
  // each outer edge). Because the final book is read rotated 90deg from
  // the flat sheet, panels bake a 90deg rotation instead of the
  // 0/180 split the other templates use — and, per the reference sketch,
  // which of the two (90 = tilt head right to read on the flat sheet, or
  // 270 = tilt head left) varies panel-by-panel rather than by whole row:
  //
  //   FRONT (covers + pages 9-14)
  //     Row 0 (top):    Page 13(90) | Page 10(90) | Page 9(90)  | Front Cover(270)
  //     Row 1 (bottom): Page 14(90) | Page 11(270)| Page 12(270)| Back Cover(270)
  //   BACK (pages 1-8)
  //     Row 0 (top):    Page 5(270) | Page 6(270) | Page 7(270) | Page 8(270)
  //     Row 1 (bottom): Page 4(90)  | Page 3(90)  | Page 2(90)  | Page 1(90)
  'pants-16up': {
    id: 'pants-16up',
    name: '16-Page Pants Zine (two-sided, one cut, read vertically)',
    description: 'Both sides have 8 panels; cut a slit across 3/4 of the width on both sides after printing, then fold. Read the finished booklet in portrait — turned 90° from how the flat sheet prints.',
    orientation: 'landscape',
    front: {
      grid: { columns: 4, rows: 2 },
      panels: [
        { id: 'page-13', label: 'Page 13', row: 0, col: 0, rotate: 90 },
        { id: 'page-10', label: 'Page 10', row: 0, col: 1, rotate: 90 },
        { id: 'page-9', label: 'Page 9', row: 0, col: 2, rotate: 90 },
        { id: 'front-cover', label: 'Front Cover', row: 0, col: 3, rotate: 270 },
        { id: 'page-14', label: 'Page 14', row: 1, col: 0, rotate: 90 },
        { id: 'page-11', label: 'Page 11', row: 1, col: 1, rotate: 270 },
        { id: 'page-12', label: 'Page 12', row: 1, col: 2, rotate: 270 },
        { id: 'back-cover', label: 'Back Cover', row: 1, col: 3, rotate: 270 },
      ],
      // Touches the sheet's right edge (where Front Cover meets Back
      // Cover, both in the rightmost column) and runs 3/4 of the width
      // into the page from there.
      cutLine: { y: 0.5, x1: 0.25, x2: 1 },
    },
    back: {
      grid: { columns: 4, rows: 2 },
      panels: [
        { id: 'page-5', label: 'Page 5', row: 0, col: 0, rotate: 270 },
        { id: 'page-6', label: 'Page 6', row: 0, col: 1, rotate: 270 },
        { id: 'page-7', label: 'Page 7', row: 0, col: 2, rotate: 270 },
        { id: 'page-8', label: 'Page 8', row: 0, col: 3, rotate: 270 },
        { id: 'page-4', label: 'Page 4', row: 1, col: 0, rotate: 90 },
        { id: 'page-3', label: 'Page 3', row: 1, col: 1, rotate: 90 },
        { id: 'page-2', label: 'Page 2', row: 1, col: 2, rotate: 90 },
        { id: 'page-1', label: 'Page 1', row: 1, col: 3, rotate: 90 },
      ],
      // Touches the sheet's right edge (where Front Cover meets Back
      // Cover, both in the rightmost column) and runs 3/4 of the width
      // into the page from there.
      cutLine: { y: 0.5, x1: 0.25, x2: 1 },
    },
  },
};

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['punk-8up'];
}

// A side is either { poster: true } or { grid, panels, cutLine }.
export function getSideConfig(template, side) {
  return template[side];
}

export function isPosterSide(template, side) {
  return !!template[side].poster;
}

export function getSideGrid(template, side) {
  return template[side].grid || null;
}

export function getSidePanels(template, side) {
  return template[side].panels || [];
}

export function getSideCutLine(template, side) {
  return template[side].cutLine || null;
}

export function getPanel(template, side, panelId) {
  return getSidePanels(template, side).find((p) => p.id === panelId) || null;
}

// Panels sharing a row do NOT necessarily share a baked rotation (see
// pants-16up above) — unlike the 0/180 templates, same-row neighbor
// dragging can cross a rotation change here, which canvas.js accounts
// for directly rather than assuming a shared sign.
export function getRowPanels(template, side, row) {
  return getSidePanels(template, side).filter((p) => p.row === row).sort((a, b) => a.col - b.col);
}
