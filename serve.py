#!/usr/bin/env python3
"""Local dev server for this project.

Plain `python3 -m http.server` lets browsers cache the .js files based on
Last-Modified, which can serve a stale copy of a file you just edited
until a hard refresh. This adds Cache-Control: no-store to every response
so edits are always picked up on a normal reload.

That alone only prevents *future* caching, though — it can't invalidate a
copy the browser already cached before this server (or this header)
existed, and a browser's HTTP cache is shared across all tabs for an
origin, so even a brand-new tab can still get served that pre-existing
stale copy without ever hitting the network. Clear-Site-Data tells the
browser to actively wipe its cache for this origin on every load, which
covers that case too — the closest thing to guaranteeing "no stale copy
survives a normal reload" without requiring a manual hard-refresh.
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Clear-Site-Data', '"cache"')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.test(HandlerClass=NoCacheHandler, port=port)
