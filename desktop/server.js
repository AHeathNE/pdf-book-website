// A minimal static file server, Node built-ins only — no npm dependency
// needed just to serve the editor/viewer's own files. Mirrors serve.py's
// role for local browser development: the app's ES modules and fetch()
// calls (book.json, the shared/* imports, export-standalone.js pulling
// in viewer source) are blocked by the browser on file:// origins, so
// Electron's window loads this over http://localhost instead, exactly
// like the dev workflow already does.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Starts serving `rootDir` and resolves with the port actually bound.
// Tries `preferredPort` first, then a few ports after it, so a second
// launch (or a stale process still holding the port) doesn't just crash —
// see the fixed-port comment in main.js for why this range is narrow
// rather than "any free port".
function startServer(rootDir, preferredPort, attempts = 5) {
  return new Promise((resolve, reject) => {
    function tryPort(port, attemptsLeft) {
      const server = http.createServer((req, res) => {
        const requestPath = decodeURIComponent(req.url.split('?')[0]);
        const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(rootDir, safePath);

        // Never serve a path that escaped rootDir via traversal.
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (err, stats) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const finalPath = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
          fs.readFile(finalPath, (readErr, data) => {
            if (readErr) {
              res.writeHead(404);
              res.end('Not found');
              return;
            }
            res.writeHead(200, {
              'Content-Type': contentTypeFor(finalPath),
              'Cache-Control': 'no-store',
            });
            res.end(data);
          });
        });
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryPort(port + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      });

      server.listen(port, '127.0.0.1', () => resolve({ server, port }));
    }

    tryPort(preferredPort, attempts);
  });
}

module.exports = { startServer };
