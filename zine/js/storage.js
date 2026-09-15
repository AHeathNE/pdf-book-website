import { cloneProject } from './schema.js';
import { state, loadProject, registerAsset } from './store.js';

const DB_NAME = 'zine-editor';
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
  await idbSet({ project: cloneProject(state.project), assets });
}

// A side is either a poster ({ objects: [...] }) or a panel grid (a map
// of panelId -> { objects: [...] }) — detect which shape we're looking
// at rather than assuming (pants-16up's back is a grid, unlike the other
// two templates' poster back).
function remapSideImages(sideJson, remap) {
  if (!sideJson) return;
  if (Array.isArray(sideJson.objects)) {
    for (const obj of sideJson.objects) {
      if (obj.type === 'image') obj.src = remap(obj.src);
    }
    return;
  }
  for (const panel of Object.values(sideJson)) {
    for (const obj of panel.objects || []) {
      if (obj.type === 'image') obj.src = remap(obj.src);
    }
  }
}

function remapImages(projectJson, remap) {
  remapSideImages(projectJson.front, remap);
  remapSideImages(projectJson.back, remap);
}

export async function restoreFromIndexedDb() {
  const record = await idbGet();
  if (!record) return false;

  const urlMap = new Map();
  for (const { url, filename, blob } of record.assets) {
    urlMap.set(url, registerAsset(blob, filename));
  }
  const projectJson = record.project;
  remapImages(projectJson, (v) => (typeof v === 'string' && urlMap.has(v) ? urlMap.get(v) : v));
  loadProject(projectJson);
  return true;
}
