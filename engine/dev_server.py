"""Run the page locally, the way Qollab runs it.

    python -m engine.dev_server          then open http://127.0.0.1:8000
    python -m engine.dev_server basic    use Qiskit's BasicSimulator, as on
                                         Qollab's built-in simulator

Qollab loads index.html and runs main.js, which calls engine.bridge in the
browser. Here, index.html gets local.js instead, which calls the same
bridge functions over HTTP.
"""

import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import bridge

ROOT = Path(__file__).resolve().parent.parent

if "basic" in sys.argv[1:]:
    from qiskit.providers.basic_provider import BasicSimulator

    BACKEND = BasicSimulator()
else:
    from qiskit_aer import AerSimulator

    BACKEND = AerSimulator()

app = FastAPI(title="Canary (local)")


@app.get("/api/build")
def build(seed: int = 1):
    return json.loads(bridge.build(seed))


@app.get("/api/layout")
def layout(n_traps: int = 20):
    return json.loads(bridge.layout(n_traps))


@app.get("/api/send")
def send(shots: int = 300):
    return json.loads(bridge.send(BACKEND, shots))


@app.get("/api/report")
def report(strategy: str = "cheap", n_traps: int = 20, skip: float = 0.3):
    return json.loads(bridge.report(strategy, n_traps, skip))


@app.get("/api/smart")
def smart(real_kind: str = "flat"):
    return json.loads(bridge.smart(real_kind))


@app.get("/", response_class=HTMLResponse)
def index():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return html.replace("</body>", '<script type="module" src="local.js"></script>\n</body>')


app.mount("/", StaticFiles(directory=ROOT), name="root")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
