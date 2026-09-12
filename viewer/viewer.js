import { normalizeBook } from '../shared/schema.js';
import { renderPage, applyStageBackground } from '../shared/renderer.js';
import { computeSpreadPlan, computeToc } from '../shared/pagination.js';

async function main() {
  const res = await fetch('book.json');
  const raw = await res.json();
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
  const indicator = document.getElementById('pageIndicator');
  const hint = document.getElementById('hint');
  const { widthPx, heightPx, dpi } = book.pageSize;

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
      inner.style.transformOrigin = 'top left';
      inner.style.transform = `scale(${scale})`;
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

  // The book has a fixed page aspect ratio but must still fit whatever
  // viewport it's shown in, so we compute an explicit pixel size that fits
  // the stage (accounting for a two-page spread being twice as wide as a
  // single page) and pin PageFlip's min/max to that exact size, rebuilding
  // on resize rather than letting PageFlip's own responsive CSS fight for
  // vertical space it can't see.
  function fitSingleWidth() {
    const availW = stage.clientWidth;
    const availH = (stage.clientHeight - VERTICAL_BREATHING_ROOM) * heightScaleFactor();
    const byHeight = availH * (widthPx / heightPx);
    const byWidth = availW / 2;
    return Math.max(120, Math.min(byHeight, byWidth));
  }

  function rebuild() {
    const singleW = fitSingleWidth();
    const singleH = singleW * (heightPx / widthPx);

    if (pageFlip) pageFlip.destroy(); // removes the old bookEl — it's being replaced anyway
    bookEl = document.createElement('div');
    bookHost.appendChild(bookEl);
    buildPageElements(bookEl, singleW / widthPx);

    pageFlip = new St.PageFlip(bookEl, {
      width: singleW,
      height: singleH,
      size: 'fixed',
      minWidth: singleW,
      maxWidth: singleW,
      minHeight: singleH,
      maxHeight: singleH,
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
    pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
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

  document.getElementById('prevBtn').addEventListener('click', () => pageFlip.flipPrev());
  document.getElementById('nextBtn').addEventListener('click', () => pageFlip.flipNext());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') pageFlip.flipNext();
    if (e.key === 'ArrowLeft') pageFlip.flipPrev();
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
