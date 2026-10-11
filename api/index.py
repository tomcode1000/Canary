"""Canary's engine as a stateless serverless API (Vercel).

Serverless instances keep no memory between requests, so every call carries
the seed and shots, and an instance that hasn't seen them rebuilds the run.
The backend is Qiskit's BasicSimulator, seeded, so a rebuild gives exactly
the same results. Uses only the standard library and Qiskit.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qiskit.providers.basic_provider import BasicSimulator  # noqa: E402

from engine import bridge  # noqa: E402


def backend():
    b = BasicSimulator()
    b.set_options(seed_simulator=11)
    return b


def ensure(seed, shots=None):
    if bridge._state.get("seed") != seed:
        bridge.build(seed)
    if shots and (bridge._state.get("runs") is None or bridge._state.get("sent", {}).get("shots") != shots):
        bridge.send(backend(), shots)


def route(name, q):
    seed = int(q.get("seed", 1))
    shots = int(q.get("shots", 300))
    if name == "build":
        return bridge.build(seed)
    if name == "layout":
        ensure(seed)
        return bridge.layout(int(q.get("n_traps", 20)))
    if name == "send":
        ensure(seed)
        return bridge.send(backend(), shots)
    if name == "report":
        ensure(seed, shots)
        return bridge.report(q.get("strategy", "cheap"), int(q.get("n_traps", 20)), float(q.get("skip", 0.3)))
    if name == "smart":
        ensure(seed, shots)
        return bridge.smart(q.get("real_kind", "flat"))
    return None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        name = url.path.rstrip("/").split("/")[-1]
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            body = route(name, q)
            code = 200 if body is not None else 404
            body = body if body is not None else json.dumps({"error": "unknown endpoint"})
        except Exception as e:  # report, don't crash the page
            code, body = 500, json.dumps({"error": str(e)})
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
