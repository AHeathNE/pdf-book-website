// Renders a single page's data into DOM nodes. Framework-free, shared by the
// viewer (read-only) and the editor canvas (editable). The editor layers
// selection/drag/resize handling on top of the elements this returns; this
// module only ever reflects the data model into the DOM.

function applyBoxStyle(el, obj) {
  el.style.position = 'absolute';
  el.style.left = `${obj.x}px`;
  el.style.top = `${obj.y}px`;
  el.style.width = `${obj.w}px`;
  el.style.height = `${obj.h}px`;
  el.style.zIndex = String(obj.z || 1);
  el.style.transform = obj.rot ? `rotate(${obj.rot}deg)` : '';
  el.style.boxSizing = 'border-box';
}

function buildTextObject(obj) {
  const el = document.createElement('div');
  el.className = 'pbw-object pbw-object--text';
  applyBoxStyle(el, obj);
  el.style.fontFamily = obj.fontFamily;
  el.style.fontSize = `${obj.fontSize}px`;
  el.style.color = obj.color;
  el.style.textAlign = obj.align;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = obj.content;
  return el;
}

function buildImageObject(obj) {
  const wrap = document.createElement(obj.link ? 'a' : 'div');
  wrap.className = 'pbw-object pbw-object--image';
  applyBoxStyle(wrap, obj);
  wrap.style.overflow = 'hidden';
  if (obj.link) {
    wrap.href = obj.link;
    wrap.target = '_blank';
    wrap.rel = 'noopener noreferrer';
  }
  const img = document.createElement('img');
  img.src = obj.src;
  img.alt = obj.alt || '';
  img.draggable = false;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.pointerEvents = 'none';
  img.style.display = 'block';
  wrap.appendChild(img);
  return wrap;
}

function buildLinkObject(obj) {
  const a = document.createElement('a');
  a.className = 'pbw-object pbw-object--link';
  applyBoxStyle(a, obj);
  a.href = obj.href;
  a.target = obj.target || '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = obj.label;
  a.style.display = 'flex';
  a.style.alignItems = 'center';
  a.style.justifyContent = 'center';
  a.style.background = obj.bgColor;
  a.style.color = obj.textColor;
  a.style.borderRadius = '4px';
  a.style.textDecoration = 'none';
  a.style.fontFamily = 'sans-serif';
  a.style.fontSize = '14px';
  return a;
}

const BUILDERS = { text: buildTextObject, image: buildImageObject, link: buildLinkObject };

// How a background image fills its box: 'cover' (Fill — crop to fill,
// keep aspect), 'contain' (Fit — show the whole image, keep aspect),
// 'stretch' (distort to fill exactly), or 'repeat' (tile at natural size).
function applyBackgroundFit(el, fit) {
  if (fit === 'stretch') {
    el.style.backgroundSize = '100% 100%';
    el.style.backgroundRepeat = 'no-repeat';
  } else if (fit === 'contain') {
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
  } else if (fit === 'repeat') {
    el.style.backgroundSize = 'auto';
    el.style.backgroundRepeat = 'repeat';
  } else {
    el.style.backgroundSize = 'cover';
    el.style.backgroundRepeat = 'no-repeat';
  }
}

function applyPageBackground(containerEl, background) {
  containerEl.style.backgroundColor = '#ffffff';
  containerEl.style.backgroundImage = '';
  containerEl.style.backgroundSize = '';
  containerEl.style.backgroundPosition = '';
  containerEl.style.backgroundRepeat = '';
  if (!background) return;
  if (background.type === 'color') {
    containerEl.style.backgroundColor = background.value;
  } else if (background.type === 'image') {
    containerEl.style.backgroundImage = `url("${background.value}")`;
    applyBackgroundFit(containerEl, background.fit);
    containerEl.style.backgroundPosition = 'center';
  }
}

/**
 * Renders pageData into containerEl (which the caller must already size to
 * book.pageSize). Returns { objectEls: Map<id, HTMLElement> } so editable
 * callers (the editor canvas) can attach selection/drag/resize behavior.
 *
 * options.editable adds a class + click->onSelect wiring; it does not add
 * drag/resize itself.
 */
export function renderPage(pageData, containerEl, options = {}) {
  const { editable = false, onSelect = null } = options;
  containerEl.innerHTML = '';
  containerEl.style.position = 'relative';
  containerEl.style.overflow = 'hidden';
  applyPageBackground(containerEl, pageData.background);

  const objectEls = new Map();
  const sorted = [...pageData.objects].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const obj of sorted) {
    const builder = BUILDERS[obj.type] || buildTextObject;
    const el = builder(obj);
    el.dataset.objectId = obj.id;
    if (editable) {
      el.classList.add('pbw-object--editable');
      el.addEventListener('mousedown', (e) => {
        if (onSelect) {
          e.stopPropagation();
          onSelect(obj.id, e);
        }
      });
    }
    containerEl.appendChild(el);
    objectEls.set(obj.id, el);
  }
  return { objectEls };
}

export function applyStageBackground(stageEl, background) {
  stageEl.style.backgroundColor = '#2b2b2b';
  stageEl.style.backgroundImage = '';
  stageEl.style.backgroundSize = '';
  stageEl.style.backgroundPosition = '';
  stageEl.style.backgroundRepeat = '';
  if (!background) return;
  if (background.type === 'color') {
    stageEl.style.backgroundColor = background.value;
  } else if (background.type === 'gradient') {
    stageEl.style.backgroundImage = background.value;
  } else if (background.type === 'image') {
    stageEl.style.backgroundImage = `url("${background.value}")`;
    applyBackgroundFit(stageEl, background.fit);
    stageEl.style.backgroundPosition = 'center';
  }
}
