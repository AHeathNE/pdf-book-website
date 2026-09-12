// How pages group into displayed spreads, honoring independent front/back
// "sits alone, not paired" cover flags. This mirrors the exact pairing
// StPageFlip computes internally (the first page is forced single whenever
// showCover is on, then pages pair up sequentially, leaving a natural
// single last page whenever the remaining count is odd) so the editor's
// static spread view and the viewer's interactive flip always agree.

function trailingSingle(count, startAt) {
  return (count - startAt) % 2 !== 0;
}

// Returns { pages, showCover }. `pages` is `pages` with one synthetic
// `null` filler appended at the end when needed so the natural trailing-
// single outcome matches the requested `back` flag regardless of the
// book's actual page count; `showCover` is the flag that reproduces the
// requested `front` behavior (StPageFlip has no separate "back" setting —
// back-alone falls out of page-count parity, which the filler corrects).
export function computeSpreadPlan(pages, covers) {
  const front = !!(covers && covers.front);
  const back = !!(covers && covers.back);
  const startAt = front ? 1 : 0;
  let list = pages;
  if (list.length > 0 && trailingSingle(list.length, startAt) !== back) {
    list = [...pages, null];
  }
  return { pages: list, showCover: front };
}

// Groups a page list into spreads of one (cover/back/odd-leftover) or two
// (a facing pair), using the same rule as computeSpreadPlan/StPageFlip.
// Each spread is an array of 1-2 entries; an entry is `null` for the
// synthetic filler.
export function computeSpreads(pages, covers) {
  const { pages: list, showCover } = computeSpreadPlan(pages, covers);
  const spreads = [];
  let i = 0;
  if (showCover && list.length > 0) {
    spreads.push([list[0]]);
    i = 1;
  }
  for (; i < list.length; i += 2) {
    if (i < list.length - 1) spreads.push([list[i], list[i + 1]]);
    else spreads.push([list[i]]);
  }
  return spreads;
}

export function findSpreadIndexForPageId(spreads, pageId) {
  for (let i = 0; i < spreads.length; i += 1) {
    if (spreads[i].some((p) => p && p.id === pageId)) return i;
  }
  return 0;
}

// Table of contents entries: one per page with a non-blank tocLabel, in
// page order, carrying that page's index within `pages` (not within any
// spread-padded presentation list — the synthetic filler from
// computeSpreadPlan is only ever appended at the very end, so a real
// page's index is the same in both).
export function computeToc(pages) {
  const entries = [];
  pages.forEach((page, index) => {
    const label = page.tocLabel && page.tocLabel.trim();
    if (label) entries.push({ label, pageIndex: index, pageId: page.id });
  });
  return entries;
}
