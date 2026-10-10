"""HTTP API and the page, from one process.

    python -m engine.api          then open http://127.0.0.1:8000
"""

import json
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .job import JobReport, run_job
from .servers import STRATEGIES, HonestServer, SkimpServer

WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Canary")


def _report(r: JobReport, top_k: int = 4) -> dict:
    shots = sum(r.results[0].counts.values()) if r.results else 0
    return {
        "server": r.server,
        "blurb": r.blurb,
        "cost": r.cost,
        "receipt": {
            "traps": r.receipt.traps,
            "failed": r.receipt.failed,
            "caught": r.receipt.caught,
            "confidence": r.receipt.confidence,
            "max_wrong": r.receipt.max_wrong,
            "min_right": r.receipt.min_right,
            "line": r.receipt.line(),
        },
        "truth": {"real_jobs": r.real_jobs, "wrong": r.actually_wrong, "wrong_share": r.actually_wrong_share, "receipt_held": r.receipt_held},
        "circuits": [
            {
                "kind": c.kind,
                "answer": c.answer,
                "expected": c.expected,
                "ok": c.ok,
                "top": [[k, v / shots] for k, v in sorted(c.counts.items(), key=lambda kv: -kv[1])[:top_k]],
            }
            for c in r.results
        ],
    }


@lru_cache(maxsize=64)
def _run(real_kind: str, n_real: int, n_traps: int, strategy: str, skip: float, seed: int) -> dict:
    cheater = SkimpServer(seed, skip) if strategy == "skimp" else STRATEGIES[strategy](seed)
    batch, (honest, cheat) = run_job([HonestServer(seed), cheater], n_real, n_traps, 1000, real_kind, seed)
    return {
        "params": {"real_kind": real_kind, "n_real": n_real, "n_traps": n_traps, "strategy": strategy, "skip": skip, "seed": seed},
        "circuit_preview": batch[0].circuit.draw(output="text", fold=-1).single_string(),
        "servers": [_report(honest), _report(cheat)],
    }


@app.get("/api/run")
def run(
    strategy: str = "cheap",
    real_kind: str = Query("peaked", pattern="^(peaked|flat)$"),
    n_real: int = Query(30, ge=1, le=60),
    n_traps: int = Query(20, ge=0, le=60),
    skip: float = Query(0.3, ge=0.0, le=1.0),
    seed: int = 1,
):
    if strategy not in STRATEGIES:
        raise HTTPException(400, f"strategy must be one of {sorted(STRATEGIES)}")
    return _run(real_kind, n_real, n_traps, strategy, round(skip, 2), seed)


@app.get("/api/strategies")
def strategies():
    return [{"name": name, "blurb": cls.blurb} for name, cls in STRATEGIES.items()]


@app.get("/api/odds")
def odds():
    path = WEB / "data" / "odds.json"
    if not path.exists():
        raise HTTPException(404, "run `python -m engine.odds` first")
    return JSONResponse(json.loads(path.read_text()))


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/", StaticFiles(directory=WEB), name="web")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
