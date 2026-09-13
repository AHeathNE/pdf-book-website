'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { startServer } = require('./server');

// Fixed (not random) so the app's origin — and therefore IndexedDB
// autosave and the unit/zoom/etc. preferences kept in localStorage —
// stays the same across launches. A random port would make every launch
// look like a fresh origin with nothing remembered. startServer() still
// tries a few ports upward if this one's taken (e.g. a second instance,
// or something else already using it).
const PREFERRED_PORT = 47861;

let mainWindow;
let httpServer;

// Electron's GPU process can be unreliable on constrained/virtualized
// display setups (seen directly while testing this: a GPU-process crash
// loop under an unusual X11 setup) — this app is document editing, not
// 3D rendering, so trading away hardware acceleration for reliability
// costs nothing it needs.
app.disableHardwareAcceleration();

async function createWindow() {
  const { server, port } = await startServer(path.join(__dirname, '..'), PREFERRED_PORT);
  httpServer = server;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f24', // matches editor.css --panel, avoids a white flash before content paints
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.log(`[renderer] ${message}`); // 2=warning, 3=error
  });

  // Every export (PDF, website zip, standalone HTML, Save Project) works
  // by clicking a hidden `<a download href="blob:...">` — the standard
  // way a plain web page triggers a save. Confirmed directly that without
  // this, Electron doesn't recognize that as a download at all: it just
  // opens the blob: URL in a bare new window instead, since there's no
  // real user click backing the request the way a browser normally
  // expects. Routing it through downloadURL() forces the save Chrome
  // would have done anyway, and denying the window open stops the stray
  // blob: window from appearing alongside it.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      mainWindow.webContents.downloadURL(url);
    }
    return { action: 'deny' };
  });
  // Saves straight to the OS Downloads folder under the suggested name —
  // no picker dialog — matching how these exports already behave for
  // every user of the plain web app today.
  mainWindow.webContents.session.on('will-download', (event, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/editor/index.html`);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (httpServer) httpServer.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// No application menu at all, rather than a custom one with standard
// roles (Undo/Redo/Cut/Copy/Paste) — those register OS-level keyboard
// accelerators that would compete with the editor's own Ctrl+Z/X/C/V
// handling (its own undo stack, its own clipboard logic for objects) for
// the exact same key combinations. Simplest way to guarantee the page's
// own keydown handling is what actually receives them.
Menu.setApplicationMenu(null);
