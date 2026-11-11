#!/usr/bin/env python3
"""Serve editor/ for local development and end-to-end tests.

Same as `python3 -m http.server`, with a listen backlog large enough for a
browser loading the app's ES modules in parallel. The stdlib default (5)
makes the server reset connections under that burst, and a module that
fails to load stops the whole app from starting.

Usage: python3 scripts/serve.py [PORT]   (default 8080)
"""
import functools
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files that browsers revalidate on every load.

    Without a Cache-Control header a browser caches the app's ES modules
    heuristically (a fraction of the file's age), so after an edit it keeps
    running the old code until a hard reload. `no-cache` still allows 304
    responses, so unchanged files stay cheap.
    """

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'editor')
    handler = functools.partial(Handler, directory=root)
    with Server(('', port), handler) as httpd:
        print(f'Serving editor/ at http://127.0.0.1:{port}/', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
