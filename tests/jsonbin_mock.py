#!/usr/bin/env python3
"""Tiny in-memory stand-in for the jsonbin.io v3 API, for testing device sync locally.

  python3 tests/jsonbin_mock.py 8899
Then open tests/sync-harness.html (it redirects https://api.jsonbin.io to this server).
Open it from two origins (http://localhost:8765/… and http://127.0.0.1:8765/…) to act as two devices.
"""
import json
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "test-master-key"
BINS = {}
LIMIT = 100 * 1024


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Master-Key, X-Bin-Meta, X-Bin-Private, X-Bin-Name")
        self.end_headers()

    def _auth(self):
        if self.headers.get("X-Master-Key") != KEY:
            self._send(401, {"message": "Invalid X-Master-Key provided"})
            return False
        return True

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n)
        if n > LIMIT:
            self._send(403, {"message": "Requests exceeding 100kb are not allowed"})
            return None
        return json.loads(raw)

    def do_POST(self):
        if self.path.rstrip("/") != "/v3/b" or not self._auth():
            return
        rec = self._body()
        if rec is None:
            return
        bid = uuid.uuid4().hex[:24]
        BINS[bid] = rec
        self._send(200, {"record": rec, "metadata": {"id": bid, "private": True}})

    def do_PUT(self):
        bid = self.path.rsplit("/", 1)[-1]
        if not self._auth():
            return
        if bid not in BINS:
            return self._send(404, {"message": "Bin not found"})
        rec = self._body()
        if rec is None:
            return
        BINS[bid] = rec
        self._send(200, {"record": rec, "metadata": {"parentId": bid}})

    def do_GET(self):
        parts = self.path.strip("/").split("/")
        if not self._auth():
            return
        if len(parts) >= 3 and parts[2] in BINS:
            rec = BINS[parts[2]]
            return self._send(200, rec if self.headers.get("X-Bin-Meta") == "false" else {"record": rec, "metadata": {"id": parts[2]}})
        self._send(404, {"message": "Bin not found"})

    def log_message(self, *a):
        sys.stderr.write("mock " + (a[0] % a[1:]) + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
