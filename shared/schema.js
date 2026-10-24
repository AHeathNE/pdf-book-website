// Book data model: defaults, factory functions, normalization.
// Shared, framework-free ES module used by both the editor and the viewer.

export const SCHEMA_VERSION = 1;

// Dither methods the workstation can apply to the whole book (see
// editor/js/dither.js for the algorithms themselves).
export const DITHER_TYPE_IDS = ['floyd', 'atkinson', 'ordered', 'threshold'];

let idCounter = 0;
export function uid(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newBook(overrides = {}) {
  return {
    version: SCHEMA_VERSION,
    title: 'Untitled Book',
    pageSize: { widthPx: 800, heightPx: 1100, dpi: 150 },
    background: { type: 'color', value: '#2b2b2b', fit: 'cover' },
    // 'horizontal': pages pair left/right (a normal book). 'vertical':
    // pages pair top/bottom instead — margins.top/bottom double as the
    // left/right margins in that mode (see canvas.js's marginBoxFor),
    // since whichever axis pages face each other across is the one
    // margins.inner/outer apply to, and the other axis's margins just
    // don't need separate fields of their own.
    orientation: 'horizontal',
    margins: { top: 60, bottom: 60, inner: 70, outer: 50 },
    grid: { columns: 6, rows: 8, color: '#66b3ff', show: true, snap: true, origin: 'page' },
    covers: { front: true, back: true },
    // One setting for the whole book: when enabled, every page is reduced to
    // two colors (ink on paper) by the chosen method, in the editor preview
    // and in every export. dotSize is how many page px one dot covers.
    // Exports also fill in `images` ({ pageId: src }) — pre-rendered dithered
    // pages the viewer lays over the live ones — which never exists in the
    // editor's own copy of the book.
    dither: {
      enabled: false, type: 'floyd', dotSize: 2, contrast: 0, brightness: 0, ink: '#000000', paper: '#ffffff',
    },
    pages: [newPage(), newPage()],
    ...overrides,
  };
}

export function newPage(overrides = {}) {
  return {
    id: uid('page'),
    background: null, // null | { type: 'color'|'image', value }
    objects: [],
    tocLabel: null, // string | null — set to give this page a Table of Contents entry
    ...overrides,
  };
}

function baseObject(type, overrides) {
  return {
    id: uid('obj'),
    type,
    x: 40,
    y: 40,
    w: 200,
    h: 100,
    rot: 0,
    z: 1,
    lockRatio: false,
    ...overrides,
  };
}

export function newTextObject(overrides = {}) {
  return baseObject('text', {
    content: 'New text',
    fontFamily: 'Georgia, serif',
    // ~16pt at the default 150dpi (px = pt/72*dpi) — stored as native px
    // like every other dimension (see rescaleBookForNewDpi), but chosen
    // to read as a normal body/heading-ish size once the editor's Font
    // size field converts it back to pt for display.
    fontSize: 33,
    color: '#111111',
    align: 'left',
    bold: false,
    italic: false,
    // Keeps the box from ending up shorter than its text (editor only; see
    // editor/js/text-fit.js). On for new text; normalizeObject leaves
    // objects from before this existed off, so they don't change.
    autoGrow: true,
    w: 240,
    h: 80,
    ...overrides,
  });
}

export function newImageObject(overrides = {}) {
  return baseObject('image', {
    src: '',
    alt: '',
    link: null,
    w: 240,
    h: 180,
    ...overrides,
  });
}

export function newLinkObject(overrides = {}) {
  return baseObject('link', {
    href: 'https://',
    label: 'Learn more',
    target: '_blank',
    bgColor: '#111111',
    textColor: '#ffffff',
    w: 160,
    h: 44,
    ...overrides,
  });
}

export function cloneBook(book) {
  return JSON.parse(JSON.stringify(book));
}

// Fills in any missing fields on a possibly-partial/older book so the rest
// of the app can assume a fully-shaped object.
export function normalizeBook(raw) {
  const defaults = newBook();
  const book = {
    ...defaults,
    ...raw,
    orientation: raw.orientation === 'vertical' ? 'vertical' : 'horizontal',
    pageSize: { ...defaults.pageSize, ...(raw.pageSize || {}) },
    background: { ...defaults.background, ...(raw.background || {}) },
    margins: { ...defaults.margins, ...(raw.margins || {}) },
    grid: { ...defaults.grid, ...(raw.grid || {}) },
    covers: { ...defaults.covers, ...(raw.covers || {}) },
    dither: normalizeDither(raw.dither, defaults.dither),
    pages: Array.isArray(raw.pages) && raw.pages.length ? raw.pages.map(normalizePage) : defaults.pages,
  };
  return book;
}

function normalizeDither(raw, defaults) {
  const merged = { ...defaults, ...(raw || {}) };
  if (!DITHER_TYPE_IDS.includes(merged.type)) merged.type = defaults.type;
  merged.enabled = merged.enabled === true;
  return merged;
}

function normalizePage(raw) {
  return {
    id: raw.id || uid('page'),
    background: raw.background || null,
    objects: Array.isArray(raw.objects) ? raw.objects.map(normalizeObject) : [],
    tocLabel: raw.tocLabel || null,
  };
}

function normalizeObject(raw) {
  const type = raw.type || 'text';
  const factory = type === 'image' ? newImageObject : type === 'link' ? newLinkObject : newTextObject;
  const obj = { ...factory(), ...raw, id: raw.id || uid('obj') };
  if (obj.type === 'text' && raw.autoGrow === undefined) obj.autoGrow = false;
  return obj;
}
