// Display-unit conversion for the editor's measurement fields. The book's
// data model always stores px; "how many px per inch" is the book's own
// pageSize.dpi (default 150 — a print-quality assumption, not the old
// 96/72-dpi screen default), so 1in = dpi px and 1cm = dpi/2.54 px. This
// only affects what the panel displays/accepts, never what's stored.

export const UNITS = ['px', 'in', 'cm'];

export function pxToUnit(px, unit, dpi) {
  if (unit === 'in') return px / dpi;
  if (unit === 'cm') return (px / dpi) * 2.54;
  return px;
}

export function unitToPx(value, unit, dpi) {
  if (unit === 'in') return value * dpi;
  if (unit === 'cm') return (value / 2.54) * dpi;
  return value;
}

export function unitStep(unit) {
  if (unit === 'px') return 1;
  return 0.05;
}

export function unitDecimals(unit) {
  return unit === 'px' ? 0 : 2;
}

export function formatForUnit(px, unit, dpi) {
  const v = pxToUnit(px, unit, dpi);
  return Number(v.toFixed(unitDecimals(unit)));
}

// Type size is conventionally measured in points everywhere (word
// processors, PDF/print tools) regardless of what unit a document's page
// is measured in — nobody sets font size in inches or cm — so this is
// intentionally independent of the page-dimension unit selector above. A
// point is fixed at 1/72in, so the book's own DPI is still what relates
// it to the stored native px.
export function pxToPt(px, dpi) {
  return (px / dpi) * 72;
}

export function ptToPx(pt, dpi) {
  return (pt / 72) * dpi;
}
