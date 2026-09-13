import { normalizeBook } from '../shared/schema.js';
import { renderPage, applyStageBackground } from '../shared/renderer.js';
import { computeSpreadPlan, computeToc } from '../shared/pagination.js';

async function main() {
  // A standalone single-file export (see editor/js/export-standalone.js)
  // sets this instead of shipping a book.json to fetch — file:// pages
  // can't fetch their own directory, which is the whole point of
  // exporting one. Every other build (local dev, the zip export) has no
  // such global, so it falls through to the normal fetch unchanged.
  const raw = window.__PBW_BOOK__ || (await fetch('book.json').then((res) => res.json()));
  const book = normalizeBook(raw);

  document.title = book.title;

  const stage = document.getElementById('stage');
  applyStageBackground(stage, book.background);

  // `bookHost` is the permanent element from the HTML; it's never handed
  // to PageFlip directly. `pageFlip.destroy()` doesn't just clear out
  // whatever element it was given — it calls `.remove()` on it, pulling
  // it out of the document entirely (confirmed in the vendored source).
  // Reusing that same element on the next rebuild silently does nothing
  // (it's rebuilding a detached node no one can see), which is exactly
  // what made the book vanish for good after the very first resize —
  // fullscreen included, since entering and leaving it both resize the
  // window. So each rebuild creates a fresh child inside the host instead
  // of reusing one across destroy() calls.
  const bookHost = document.getElementById('book');
  const bookScroll = document.getElementById('bookScroll');
  const indicator = document.getElementById('pageIndicator');
  const hint = document.getElementById('hint');
  const { widthPx, heightPx, dpi } = book.pageSize;
  const vertical = book.orientation === 'vertical';
  hint.textContent = vertical ? 'Drag or click a corner to turn the page' : 'Drag or click a bottom corner to turn the page';

  let pageFlip = null;
  let bookEl = null;
  let currentPageIndex = 0;

  // Front/back cover ("sits alone, not paired") is independently
  // requestable in the editor, but StPageFlip only has one combined
  // showCover flag plus whatever falls out of page-count parity — see
  // shared/pagination.js for how the two get reconciled (padding with one
  // invisible blank page when needed).
  const { pages: presentationPages, showCover } = computeSpreadPlan(book.pages, book.covers);

  // StPageFlip takes ownership of each `.page` element's `style` attribute
  // (rewrites it wholesale for positioning), so page content/background
  // must live on an inner wrapper it never touches, not on `.page` itself.
  function buildPageElements(container, scale) {
    container.innerHTML = '';
    presentationPages.forEach((pageData) => {
      const pageEl = document.createElement('div');
      pageEl.className = 'page';
      pageEl.dataset.density = 'soft';

      // Object coordinates are authored in the book's native pixel space
      // (book.pageSize), which is usually larger or smaller than the size
      // PageFlip actually renders the page at, so the inner wrapper stays
      // at native size and is visually scaled to fit via CSS transform.
      const inner = document.createElement('div');
      inner.className = 'page-inner';
      inner.style.width = `${widthPx}px`;
      inner.style.height = `${heightPx}px`;
      if (vertical) {
        // StPageFlip only ever flips left/right, so a vertical book is
        // rendered as a completely normal horizontal one and the whole
        // thing is rotated 90deg in rebuild() to turn that into a
        // top/bottom flip. Each page's own content has to be
        // counter-rotated here so it reads upright despite that — see the
        // matching comment in rebuild() for the full picture. Centering
        // (rather than a top-left-anchored rotation) sidesteps having to
        // hand-derive an offset: a box rotated 90deg about its own center
        // always lands with the same footprint a swapped-dimension box
        // would, so it exactly fills this now width/height-swapped `.page`
        // slot with no residual offset.
        inner.style.position = 'absolute';
        inner.style.top = '50%';
        inner.style.left = '50%';
        inner.style.transformOrigin = 'center center';
        inner.style.transform = `translate(-50%, -50%) rotate(-90deg) scale(${scale})`;
      } else {
        inner.style.transformOrigin = 'top left';
        inner.style.transform = `scale(${scale})`;
      }
      pageEl.appendChild(inner);
      if (pageData) renderPage(pageData, inner, { editable: false });

      container.appendChild(pageEl);
    });
  }

  // Reserved space above/below the book so it never sits flush against the
  // stage edges — filling the exact available height read as cramped.
  const VERTICAL_BREATHING_ROOM = 56;

  // Sizing a book purely to fill 100% of the available height regardless
  // of its actual page height would make a half-letter (5.5x8.5) or
  // quarter-letter (4.25x5.5) book look exactly as big onscreen as a full
  // letter (8.5x11) one — no sense that it's physically smaller. Scaling
  // by the true physical ratio instead is honest but makes the smallest
  // formats (half the height of letter) cramped and harder to read. This
  // splits the difference: track the true height ratio against a
  // full-letter reference, but never shrink past a floor.
  const REFERENCE_HEIGHT_IN = 11;
  const MIN_HEIGHT_SCALE = 0.65;

  function heightScaleFactor() {
    const heightIn = heightPx / dpi;
    return Math.min(1, Math.max(MIN_HEIGHT_SCALE, heightIn / REFERENCE_HEIGHT_IN));
  }

  // Reader-controlled zoom, on top of the fit-to-viewport size below —
  // "100%" means fit, same as the only behavior before this existed.
  // Unlike the editor's zoom this never goes below 100%: fit is already
  // the "see the whole book" baseline for a reader, so there's nothing
  // useful below it. Deliberately resizes the actual book (not just a
  // CSS transform) so #bookScroll gets real scrollable overflow to pan
  // through — a transform's visual overflow isn't scrollable at all.
  const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3];
  let zoomLevel = ZOOM_STEPS[0];

  // The book has a fixed page aspect ratio but must still fit whatever
  // viewport it's shown in, so we compute an explicit pixel size that fits
  // the stage (accounting for a two-page spread needing double space along
  // whichever axis pages pair on) and pin PageFlip's min/max to that exact
  // size, rebuilding on resize rather than letting PageFlip's own
  // responsive CSS fight for space it can't see.
  function fitSingleWidth() {
    const availW = bookScroll.clientWidth;
    const availH = (bookScroll.clientHeight - VERTICAL_BREATHING_ROOM) * heightScaleFactor();
    let base;
    if (vertical) {
      const byWidth = availW;
      const byHeight = (availH / 2) * (widthPx / heightPx);
      base = Math.max(120, Math.min(byWidth, byHeight));
    } else {
      const byHeight = availH * (widthPx / heightPx);
      const byWidth = availW / 2;
      base = Math.max(120, Math.min(byHeight, byWidth));
    }
    return base * zoomLevel;
  }

  function rebuild() {
    const singleW = fitSingleWidth();
    const singleH = singleW * (heightPx / widthPx);

    // destroy() only removes whatever element StPageFlip itself was
    // mounted on — bookEl for a horizontal book, but just the inner
    // flipMount for a vertical one — so it can't be relied on to clean up
    // the outer bookEl wrapper in the vertical case. Clearing bookHost
    // directly handles both.
    if (pageFlip) pageFlip.destroy();
    bookHost.innerHTML = '';
    bookEl = document.createElement('div');
    bookHost.appendChild(bookEl);

    // The element actually handed to StPageFlip — bookEl itself for a
    // normal horizontal book, or a separate inner wrapper for a vertical
    // one (see below).
    let flipMount = bookEl;

    if (vertical) {
      // StPageFlip has no vertical/top-bottom flip mode at all — only the
      // usual horizontal left/right. So this hands it a completely normal
      // book (width/height swapped: what StPageFlip thinks is one
      // "portrait" page is actually our landscape page turned on its
      // side) and rotates the whole thing 90deg, turning its normal
      // left/right flip into what reads as a top/bottom one. Each page's
      // own content is counter-rotated in buildPageElements() to stay
      // upright.
      //
      // The rotation lives on an inner `flipMount`, not bookEl itself,
      // because `transform` never factors into an element's scrollable
      // overflow (that's computed from pre-transform layout geometry) —
      // if bookEl were the rotated element, #bookScroll would size its
      // scrollable area from bookEl's *unrotated* footprint, which is
      // width/height-swapped from what's actually visible, breaking
      // panning at any zoom past fit. So bookEl instead stays a plain,
      // untransformed box sized to the true post-rotation footprint, and
      // only flipMount inside it — fully contained within bookEl's
      // already-correct size — carries the rotation.
      //
      // bookEl is deliberately a normal (position:relative, not absolute)
      // child of #book here, leaving #book's own flex + margin:auto (see
      // viewer.css) to do the actual centering — position:absolute
      // centering (inset:0 + margin:auto, or top/left:50% + a translate)
      // turns out to only make the *trailing* half of vertical overflow
      // scrollable in this browser, silently capping how far a reader can
      // pan down into a zoomed-in vertical book; a flex item's own
      // auto-margin centering doesn't have that bug in either axis.
      bookEl.style.position = 'relative';
      bookEl.style.width = `${singleW}px`;
      bookEl.style.height = `${singleH * 2}px`;

      flipMount = document.createElement('div');
      flipMount.style.position = 'absolute';
      flipMount.style.top = '50%';
      flipMount.style.left = '50%';
      flipMount.style.width = `${singleH * 2}px`;
      flipMount.style.height = `${singleW}px`;
      flipMount.style.transform = 'translate(-50%, -50%) rotate(90deg)';
      bookEl.appendChild(flipMount);
    }

    buildPageElements(flipMount, singleW / widthPx);

    pageFlip = new St.PageFlip(flipMount, {
      width: vertical ? singleH : singleW,
      height: vertical ? singleW : singleH,
      size: 'fixed',
      minWidth: vertical ? singleH : singleW,
      maxWidth: vertical ? singleH : singleW,
      minHeight: vertical ? singleW : singleH,
      maxHeight: vertical ? singleW : singleH,
      showCover,
      // For 'fixed' size, StPageFlip sizes its own wrapper to
      // `width * (usePortrait ? 1 : 2)` and then falls back to portrait
      // (one page at a time) whenever that wrapper is narrower than two
      // pages — which, left at the true default, it always is here, since
      // we size for exactly one page ourselves and let showCover/page
      // pairing (see shared/pagination.js) decide when a spread shows one
      // page vs two. That default silently forced single-page mode for
      // every spread, cover or not.
      usePortrait: false,
      maxShadowOpacity: 0.5,
      mobileScrollSupport: false,
      useMouseEvents: true,
      drawShadow: true,
    });
    pageFlip.loadFromHTML(flipMount.querySelectorAll('.page'));

    // StPageFlip forces the first page (whenever showCover is on) and a
    // trailing solo last page to "hard" density internally on load —
    // regardless of the data-density we set — giving covers a stiff,
    // flat flip instead of the soft paper curl every other page gets.
    // That's the norm for real book covers, but not the effect we want
    // here, so it's overridden back to soft right after load.
    const collection = pageFlip.getPageCollection();
    const totalPages = flipMount.querySelectorAll('.page').length;
    if (totalPages > 0) collection.getPage(0).setDensity('soft');
    if (totalPages > 1) collection.getPage(totalPages - 1).setDensity('soft');

    if (currentPageIndex > 0) pageFlip.turnToPage(currentPageIndex);

    pageFlip.on('flip', (e) => {
      currentPageIndex = e.data;
      updateIndicator();
      updateTocHighlight();
      hint.classList.add('hidden');
    });

    updateIndicator();
  }

  function updateIndicator() {
    const shown = Math.min(currentPageIndex + 1, book.pages.length);
    indicator.textContent = `${shown} / ${book.pages.length}`;
  }

  // ---- Table of contents ----
  const toc = computeToc(book.pages);
  const tocToggleBtn = document.getElementById('tocToggleBtn');
  const tocPanel = document.getElementById('tocPanel');
  const tocList = document.getElementById('tocList');

  function setTocOpen(open) {
    tocPanel.classList.toggle('open', open);
  }

  function updateTocHighlight() {
    tocList.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('current', Number(btn.dataset.pageIndex) === currentPageIndex);
    });
  }

  if (toc.length > 0) {
    tocToggleBtn.hidden = false;
    for (const entry of toc) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = entry.label;
      btn.dataset.pageIndex = String(entry.pageIndex);
      btn.addEventListener('click', () => {
        pageFlip.turnToPage(entry.pageIndex);
        currentPageIndex = entry.pageIndex;
        updateIndicator();
        updateTocHighlight();
        setTocOpen(false);
      });
      li.appendChild(btn);
      tocList.appendChild(li);
    }

    tocToggleBtn.addEventListener('click', () => setTocOpen(!tocPanel.classList.contains('open')));
    document.getElementById('tocCloseBtn').addEventListener('click', () => setTocOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setTocOpen(false);
    });
    document.addEventListener('click', (e) => {
      if (!tocPanel.classList.contains('open')) return;
      if (tocPanel.contains(e.target) || e.target === tocToggleBtn) return;
      setTocOpen(false);
    });
  }

  rebuild();

  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (vertical) {
    prevBtn.innerHTML = '&#8593;'; // up arrow
    nextBtn.innerHTML = '&#8595;'; // down arrow
  }
  prevBtn.addEventListener('click', () => pageFlip.flipPrev());
  nextBtn.addEventListener('click', () => pageFlip.flipNext());

  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  window.addEventListener('keydown', (e) => {
    if (e.key === nextKey) pageFlip.flipNext();
    if (e.key === prevKey) pageFlip.flipPrev();
  });

  const zoomIndicator = document.getElementById('zoomIndicator');
  function setZoom(z) {
    zoomLevel = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], z));
    zoomIndicator.textContent = `${Math.round(zoomLevel * 100)}%`;
    rebuild();
    // Center the initial view on whatever's now overflowing, rather than
    // leaving the reader looking at just the top-left corner of a
    // zoomed-in page.
    bookScroll.scrollLeft = (bookScroll.scrollWidth - bookScroll.clientWidth) / 2;
    bookScroll.scrollTop = (bookScroll.scrollHeight - bookScroll.clientHeight) / 2;
  }
  document.getElementById('zoomInBtn').addEventListener('click', () => {
    const next = ZOOM_STEPS.find((s) => s > zoomLevel + 0.001);
    setZoom(next === undefined ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : next);
  });
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoomLevel - 0.001);
    setZoom(prev === undefined ? ZOOM_STEPS[0] : prev);
  });

  // A plain window resize listener misses internal layout shifts that
  // change #stage's actual available space without the window itself
  // resizing (e.g. a scrollbar appearing/disappearing as the page's
  // initial layout settles) — which would otherwise leave the very first
  // render sized for a transient measurement with nothing to correct it
  // afterward. A ResizeObserver reacts to the element's real size
  // changing, whatever the cause.
  let resizeTimer = null;
  const scheduleRebuild = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 150);
  };
  new ResizeObserver(scheduleRebuild).observe(stage);
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fff;padding:2rem;">Failed to load book.json: ${err.message}</pre>`;
});
