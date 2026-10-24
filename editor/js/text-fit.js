// "Grow box to fit text": a text object with autoGrow set never ends up
// shorter than its own text. Text objects are fixed-size boxes that clip
// whatever overflows (see shared/renderer.js), so without this a bigger font
// or longer text just gets cut off at the box's bottom edge. Only the height
// follows the text — the width stays whatever the author set and the text
// wraps inside it.

const measured = new Map(); // object id -> { sig, h }: skip re-measuring until the text-affecting fields change

let probe = null;
function getProbe() {
  if (probe) return probe;
  // Styled exactly like the rendered object (see buildTextObject in
  // shared/renderer.js), just unconstrained in height so scrollHeight is
  // the full height the text needs.
  probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-99999px';
  probe.style.top = '0';
  probe.style.visibility = 'hidden';
  probe.style.boxSizing = 'border-box';
  probe.style.whiteSpace = 'pre-wrap';
  document.body.appendChild(probe);
  return probe;
}

function measureHeight(obj) {
  const el = getProbe();
  el.style.width = `${obj.w}px`;
  el.style.fontFamily = obj.fontFamily;
  el.style.fontSize = `${obj.fontSize}px`;
  el.style.fontWeight = obj.bold ? 'bold' : 'normal';
  el.style.fontStyle = obj.italic ? 'italic' : 'normal';
  el.style.textAlign = obj.align;
  el.textContent = obj.content;
  return Math.ceil(el.scrollHeight);
}

// Run after every edit (store.commit does this). Cheap: each object is
// measured once per distinct text/font/width, then just compared.
export function fitAutoGrowText(book) {
  for (const page of book.pages) {
    for (const obj of page.objects) {
      if (obj.type !== 'text' || !obj.autoGrow) continue;
      const sig = [obj.content, obj.fontFamily, obj.fontSize, obj.bold, obj.italic, obj.w, obj.align].join('\u0000');
      let entry = measured.get(obj.id);
      if (!entry || entry.sig !== sig) {
        entry = { sig, h: measureHeight(obj) };
        measured.set(obj.id, entry);
      }
      if (obj.h < entry.h) obj.h = entry.h;
    }
  }
}
