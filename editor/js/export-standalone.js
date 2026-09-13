import { state } from './store.js';
import { packageAssetsInline } from './packaging.js';

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.text();
}

// Reused verbatim from viewer/index.html (rather than a hand-duplicated
// copy here) so this export can't quietly drift out of sync with it —
// just the two script tags at the end are dropped, since inlined scripts
// replace them.
function extractViewerBody(indexHtml) {
  const match = indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!match) throw new Error('Could not find <body> in viewer/index.html');
  return match[1]
    .replace(/<script[^>]*src=["']lib\/page-flip\.browser\.js["'][^>]*><\/script>\s*/i, '')
    .replace(/<script[^>]*type=["']module["'][^>]*src=["']viewer\.js["'][^>]*><\/script>\s*/i, '');
}

// shared/*.js are ES modules (needed for the editor/dev-server build,
// where they're imported by multiple files); a standalone export instead
// concatenates all of it into one classic <script>, so `export` keywords
// need to go — there's nothing left to import it into.
function stripExports(src) {
  return src.replace(/^export\s+/gm, '');
}

// viewer.js's only imports are the three shared modules above, which
// this inlines into the same script scope anyway, so its import lines
// just need to disappear (not be replaced with anything).
function stripImports(src) {
  return src.replace(/^import\s.*?;\s*$/gm, '');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// A literal `</script` inside embedded JSON (e.g. a text object whose
// content happens to mention a script tag) would otherwise close the
// <script> block early, wherever it appears in the parsed HTML — the
// HTML parser looks for that sequence regardless of JS string context.
function escapeScriptClose(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}

export async function exportStandalone() {
  setStatus('Building standalone HTML…');
  const [schemaJs, rendererJs, paginationJs, viewerJs, viewerCss, pageFlipLib, viewerIndexHtml] = await Promise.all([
    fetchText('../shared/schema.js'),
    fetchText('../shared/renderer.js'),
    fetchText('../shared/pagination.js'),
    fetchText('../viewer/viewer.js'),
    fetchText('../viewer/viewer.css'),
    fetchText('../viewer/lib/page-flip.browser.js'),
    fetchText('../viewer/index.html'),
  ]);

  const bookForExport = await packageAssetsInline(state.book);
  const bodyMarkup = extractViewerBody(viewerIndexHtml);
  const sharedScript = [schemaJs, rendererJs, paginationJs].map(stripExports).join('\n\n');
  const viewerScript = stripImports(viewerJs);
  const bookJson = escapeScriptClose(JSON.stringify(bookForExport));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(bookForExport.title || 'Book')}</title>
<style>
${viewerCss}
</style>
</head>
<body>
${bodyMarkup}
<script>
window.__PBW_BOOK__ = ${bookJson};
</script>
<script>
${escapeScriptClose(pageFlipLib)}
</script>
<script>
${escapeScriptClose(sharedScript)}
</script>
<script>
${escapeScriptClose(viewerScript)}
</script>
</body>
</html>
`;

  const blob = new Blob([html], { type: 'text/html' });
  const name = (bookForExport.title || 'book').replace(/[^a-zA-Z0-9_.-]/g, '_');
  saveAs(blob, `${name}-standalone.html`);
  const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
  setStatus(`Standalone HTML exported (${sizeMb} MB).`);
}
