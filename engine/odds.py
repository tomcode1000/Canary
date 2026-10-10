"""The numbers behind the charts: theory, then measured runs that test it.

    python -m engine.odds [part ...]   writes web/data/odds.json (a few minutes)

catch_curve    P(caught) against the number of traps, for a server that
               fakes a share q of the circuits: theory 1 - (1 - q')^t,
               where q' = q * (1 - 2^-n) because a faked trap still passes
               if the random answer happens to be right. Measured dots
               from repeated SkimpServer runs.
quality_sweep  Machines from well calibrated to badly calibrated: share
               of traps dead vs share of real answers actually wrong. If
               traps are a fair sample of the work, the two move together.
coverage       Over many runs, how often the receipt's bound held. At 95%
               confidence it should hold in at least ~95% of runs.
"""

import json
import random
from pathlib import Path

from . import checker
from .circuits import N_QUBITS, make_batch
from .job import check
from .servers import CheapMachineServer, HonestServer, LazyServer, Server, SkimpServer, _simulate, noise_model

OUT = Path(__file__).resolve().parent.parent / "web" / "data" / "odds.json"


def theory_catch(q: float, traps: int, n_qubits: int = N_QUBITS) -> float:
    return 1 - (1 - q * (1 - 2**-n_qubits)) ** traps


def clean_bound(traps: int, n_real: int = 30) -> float:
    """The receipt's bound when every trap is alive."""
    return checker.wrong_share_bound(0, traps, n_real)


def _pool(n: int, kind: str, seed: int):
    """Build circuits once; reuse them across repeats (building is the slow part)."""
    batch = make_batch(n, n, kind, random.Random(seed))
    return [j for j in batch if not j.is_trap], [j for j in batch if j.is_trap]


def _draw(real, traps, n_real, n_traps, rng):
    batch = rng.sample(real, n_real) + rng.sample(traps, n_traps)
    rng.shuffle(batch)
    return batch


def catch_curve(q: float = 0.1, trap_counts=(1, 2, 4, 8, 12, 16, 24, 32), repeats: int = 60, n_real: int = 30) -> dict:
    real, traps = _pool(60, "peaked", 100)
    rng = random.Random(1)
    measured = []
    for t in trap_counts:
        caught = 0
        for r in range(repeats):
            batch = _draw(real, traps, n_real, t, rng)
            server = SkimpServer(seed=rng.randrange(10**9), skip=q)
            caught += check(batch, server.run([j.circuit for j in batch], 300), server).receipt.caught
        measured.append(caught / repeats)
    return {
        "q": q,
        "n_real": n_real,
        "traps": list(trap_counts),
        "theory": [theory_catch(q, t) for t in trap_counts],
        "measured": measured,
        "clean_bound": [clean_bound(t) for t in trap_counts],
        "compute_share": [t / (n_real + t) for t in trap_counts],
    }


def quality_sweep(levels=(0.0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6), n: int = 100) -> dict:
    """over1 = level, over2 = 1.5 * level (CX gates drift more than SX)."""
    real, traps = _pool(n, "peaked", 200)
    circuits = [j.circuit for j in real + traps]
    points = []
    for level in levels:
        model = noise_model(0.005, 0.06, 0.04, over1=level, over2=1.5 * level)
        counts = _simulate(circuits, 1000, model, seed=7)
        real_counts, trap_counts = counts[: len(real)], counts[len(real) :]
        points.append(
            {
                "level": level,
                "wrong": sum(checker.real_job_wrong(j, c) for j, c in zip(real, real_counts)) / len(real),
                "dead": sum(not checker.trap_passed(j, c) for j, c in zip(traps, trap_counts)) / len(traps),
            }
        )
    return {"n_real": len(real), "n_traps": len(traps), "points": points}


def coverage(runs: int = 200, n_real: int = 30, n_traps: int = 20) -> dict:
    real, traps = _pool(80, "peaked", 300)
    rng = random.Random(2)
    makers: dict[str, callable] = {
        "honest": lambda s: HonestServer(s),
        "lazy": lambda s: LazyServer(s),
        "cheap": lambda s: CheapMachineServer(s),
        "skimp 30%": lambda s: SkimpServer(s, 0.3),
    }
    out = {}
    for name, make in makers.items():
        held = 0
        for _ in range(runs):
            batch = _draw(real, traps, n_real, n_traps, rng)
            server: Server = make(rng.randrange(10**9))
            held += check(batch, server.run([j.circuit for j in batch], 1000), server).receipt_held
        out[name] = held / runs
    return {"runs": runs, "confidence": checker.CONFIDENCE, "held": out}


def main(only: list[str] | None = None):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    parts = {"catch_curve": catch_curve, "quality_sweep": quality_sweep, "coverage": coverage}
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    for name, make in parts.items():
        if not only or name in only:
            data[name] = make()
    OUT.write_text(json.dumps(data, indent=1))
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    import sys

    main(sys.argv[1:] or None)
