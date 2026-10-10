"""What the page calls, returning JSON strings.

On Qollab, main.js imports this module and passes it the `backend` you
picked. Locally, dev_server.py calls the same functions over HTTP.

The flow is: build() makes the batches (no backend needed), send() runs
everything as ONE backend job (IonQ allows one job per run), and then
report() / smart() only re-slice what came back, so sliders are instant.
"""

import hashlib
import json
import math
import random
import time
from datetime import datetime, timezone

from qiskit import qasm2

from .circuits import make_batch
from .job import Executed, JobReport, execute_batches

N_REAL = 30
MAX_TRAPS = 40
SMART_TRAPS = 20

_state: dict = {}


def _keep(n_traps: int) -> list[int]:
    """All real jobs plus the `n_traps` traps with the lowest random rank,
    so fewer traps means a random subset, not the first few on the grid."""
    rank = _state["trap_rank"]
    return [i for i, job in enumerate(_state["peaked"]) if not job.is_trap or rank[i] < n_traps]


def build(seed: int = 1) -> str:
    rng = random.Random(seed)
    peaked = make_batch(N_REAL, MAX_TRAPS, "peaked", rng)
    flat = make_batch(N_REAL, SMART_TRAPS, "flat", rng)
    traps = [i for i, j in enumerate(peaked) if j.is_trap]
    order = rng.sample(traps, len(traps))
    _state.clear()
    _state.update(seed=seed, peaked=peaked, flat=flat, trap_rank={i: order.index(i) for i in traps}, runs=None)
    return json.dumps({"seed": seed, "qasm": qasm2.dumps(peaked[0].circuit), "ops": _ops(peaked[0].circuit)})


def _angle(x: float) -> str:
    """Angles as multiples of pi where they are, decimals otherwise."""
    k = x / (math.pi / 4)
    if abs(k - round(k)) < 1e-9:
        n = round(k)
        return {0: "0", 4: "π", -4: "-π"}.get(n) or (f"{n // 2}π/2" if n % 2 == 0 else f"{n}π/4").replace("1π", "π")
    return f"{x:.2f}"


def _ops(circuit) -> list[list[str]]:
    """The circuit as the server receives it: [gate, qubits, angle]."""
    out = []
    for inst in circuit.data:
        name = inst.operation.name
        if name in ("barrier", "measure"):
            continue
        qubits = ",".join(str(circuit.find_bit(q).index) for q in inst.qubits)
        params = ",".join(_angle(float(p)) for p in inst.operation.params)
        out.append([name.upper(), qubits, params])
    return out


def layout(n_traps: int = 20) -> str:
    """The customer's view of the batch: which positions are traps."""
    batch = _state["peaked"]
    return json.dumps([{"kind": batch[i].kind, "expected": batch[i].answer if batch[i].is_trap else None} for i in _keep(n_traps)])


def send(backend, shots: int = 300) -> str:
    start = time.time()
    peaked, flat = execute_batches(backend, [_state["peaked"], _state["flat"]], shots, _state["seed"], [True, False])
    _state["runs"] = {"peaked": peaked, "flat": flat}
    _state["sent"] = {
        "backend": str(getattr(backend, "name", backend)),
        "shots": shots,
        "seconds": round(time.time() - start, 1),
        "ran_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
    return json.dumps(_state["sent"])


def _report_dict(r: JobReport, top_k: int = 4) -> dict:
    shots = sum(r.results[0].counts.values()) if r.results else 0
    # The receipt ID fingerprints exactly what this cloud returned.
    digest = hashlib.sha256(json.dumps([c.counts for c in r.results], sort_keys=True).encode()).hexdigest()
    return {
        "server": r.cloud,
        "receipt_id": f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}",
        "ran_at": _state.get("sent", {}).get("ran_at"),
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


def report(strategy: str = "cheap", n_traps: int = 20, skip: float = 0.3) -> str:
    run: Executed = _state["runs"]["peaked"]
    keep = _keep(n_traps)
    return json.dumps({"servers": [_report_dict(run.report("honest", keep=keep)), _report_dict(run.report(strategy, skip, keep=keep))]})


def smart(real_kind: str = "flat") -> str:
    run: Executed = _state["runs"][real_kind]
    keep = _keep(SMART_TRAPS) if real_kind == "peaked" else None
    return json.dumps({"servers": [_report_dict(run.report("smart", keep=keep))]})
