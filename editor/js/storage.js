import { cloneBook } from '../../shared/schema.js';
import { state, loadBook, registerAsset } from './store.js';
import { packageAssets } from './packaging.js';

const DB_NAME = 'pbw-editor';
const STORE_NAME = 'project';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

let saveTimer = null;
export function autosaveDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveToIndexedDb().catch(console.error); }, 800);
}

async function saveToIndexedDb() {
  const assets = [...state.assets.entries()].map(([url, info]) => ({ url, filename: info.filename, blob: info.blob }));
  await idbSet({ book: cloneBook(state.book), assets });
}

export async function restoreFromIndexedDb() {
  const record = await idbGet();
  if (!record) return false;

  const urlMap = new Map();
  for (const { url, filename, blob } of record.assets) {
    urlMap.set(url, registerAsset(blob, filename));
  }
  const bookJson = record.book;
  const remap = (v) => (typeof v === 'string' && urlMap.has(v) ? urlMap.get(v) : v);
  if (bookJson.background && bookJson.background.type === 'image') bookJson.background.value = remap(bookJson.background.value);
  for (const page of bookJson.pages) {
    if (page.background && page.background.type === 'image') page.background.value = remap(page.background.value);
    for (const obj of page.objects) {
      if (obj.type === 'image') obj.src = remap(obj.src);
    }
  }
  loadBook(bookJson);
  return true;
}

export async function saveProjectZip() {
  const { bookJson, files } = packageAssets(state.book);
  const zip = new JSZip();
  zip.file('book.json', JSON.stringify(bookJson, null, 2));
  for (const f of files) zip.file(f.path, f.blob);
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = (state.book.title || 'project').replace(/[^a-zA-Z0-9_.-]/g, '_');
  saveAs(blob, `${name}.pbwproject.zip`);
}

export async function openProjectZip(file) {
  const zip = await JSZip.loadAsync(file);
  const bookFile = zip.file('book.json');
  if (!bookFile) throw new Error('This zip does not contain a book.json project file.');
  const bookJson = JSON.parse(await bookFile.async('string'));

  const pathToUrl = new Map();
  const assetFiles = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith('assets/'));
  for (const f of assetFiles) {
    const blob = await f.async('blob');
    pathToUrl.set(f.name, registerAsset(blob, f.name.replace(/^assets\//, '')));
  }
  const remap = (v) => (typeof v === 'string' && pathToUrl.has(v) ? pathToUrl.get(v) : v);
  if (bookJson.background && bookJson.background.type === 'image') bookJson.background.value = remap(bookJson.background.value);
  for (const page of bookJson.pages || []) {
    if (page.background && page.background.type === 'image') page.background.value = remap(page.background.value);
    for (const obj of page.objects || []) {
      if (obj.type === 'image') obj.src = remap(obj.src);
    }
  }
  loadBook(bookJson);
}
