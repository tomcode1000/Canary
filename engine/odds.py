"""The numbers behind the charts: theory, then measured runs that test it.

    python -m engine.odds [part ...]   writes odds.js next to index.html

Runs locally on Qiskit Aer (ideal), with the same clouds as the page.
Circuits are executed once per pool; repeats re-draw batches from the
pool and re-seed the clouds.

catch_curve    P(caught) against the number of traps, for a cloud that
               fakes a share q of the circuits: theory 1 - (1 - q')^t,
               where q' = q * (1 - 2^-n) because a faked trap still passes
               if its random answer happens to be right. Measured dots
               from repeated skimp runs.
quality_sweep  Machines from well calibrated to badly calibrated: share
               of traps dead vs share of real answers actually wrong. If
               traps are a fair sample of the work, the two move together.
coverage       Over many runs, how often the receipt's bound held. At 95%
               confidence it should hold in at least ~95% of runs.
"""

import json
import random
from pathlib import Path

from qiskit_aer import AerSimulator

from . import checker, clouds
from .circuits import N_QUBITS, make_batch
from .job import check

OUT = Path(__file__).resolve().parent.parent / "odds.js"
SHOTS = 300
BACKEND = AerSimulator()


def theory_catch(q: float, traps: int, n_qubits: int = N_QUBITS) -> float:
    return 1 - (1 - q * (1 - 2**-n_qubits)) ** traps


def clean_bound(traps: int, n_real: int = 30) -> float:
    """The receipt's bound when every trap is alive."""
    return checker.wrong_share_bound(0, traps, n_real)


class Pool:
    """Real jobs and traps, each run once honestly and once miscalibrated."""

    def __init__(self, n: int, seed: int, cheap: bool = True):
        batch = make_batch(n, n, "peaked", random.Random(seed))
        circuits = [j.circuit for j in batch] + ([clouds.miscalibrate(j.circuit) for j in batch] if cheap else [])
        counts = clouds.execute(BACKEND, circuits, SHOTS)
        self.items = list(zip(batch, counts[: len(batch)], counts[len(batch) :] if cheap else counts[: len(batch)]))
        self.real = [x for x in self.items if not x[0].is_trap]
        self.traps = [x for x in self.items if x[0].is_trap]

    def draw(self, n_real: int, n_traps: int, rng: random.Random):
        chosen = rng.sample(self.real, n_real) + rng.sample(self.traps, n_traps)
        rng.shuffle(chosen)
        return [c[0] for c in chosen], [c[1] for c in chosen], [c[2] for c in chosen]

    def report(self, strategy: str, n_real: int, n_traps: int, rng: random.Random, skip: float = 0.3):
        batch, honest, cheap = self.draw(n_real, n_traps, rng)
        counts = clouds.respond(strategy, honest, cheap, rng.randrange(10**9), skip)
        return check(batch, counts, strategy, clouds.cost(strategy, SHOTS, skip))


def catch_curve(q: float = 0.1, trap_counts=(1, 2, 4, 8, 12, 16, 24, 32), repeats: int = 200, n_real: int = 30) -> dict:
    pool, rng = Pool(60, 100, cheap=False), random.Random(1)
    measured = [sum(pool.report("skimp", n_real, t, rng, skip=q).receipt.caught for _ in range(repeats)) / repeats for t in trap_counts]
    return {
        "q": q,
        "n_real": n_real,
        "repeats": repeats,
        "traps": list(trap_counts),
        "theory": [theory_catch(q, t) for t in trap_counts],
        "measured": measured,
        "clean_bound": [clean_bound(t, n_real) for t in trap_counts],
        "compute_share": [t / (n_real + t) for t in trap_counts],
    }


def quality_sweep(levels=(0.0, 0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5), n: int = 100) -> dict:
    """Over-rotation `level` on SX and `level * 5/3` on CX, plus the cheap
    machine's readout flips (the shipped cheap machine is level 0.3)."""
    batch = make_batch(n, n, "peaked", random.Random(200))
    real = [j for j in batch if not j.is_trap]
    traps = [j for j in batch if j.is_trap]
    points = []
    for level in levels:
        counts = clouds.execute(BACKEND, [clouds.miscalibrate(j.circuit, level, level * 5 / 3) for j in real + traps], SHOTS)
        rng = random.Random(7)
        counts = [clouds.flip_readout(c, clouds.CHEAP_READOUT, rng) for c in counts]
        points.append(
            {
                "level": level,
                "wrong": sum(checker.real_job_wrong(j, c) for j, c in zip(real, counts)) / len(real),
                "dead": sum(not checker.trap_passed(j, c) for j, c in zip(traps, counts[len(real) :])) / len(traps),
            }
        )
    return {"n_real": len(real), "n_traps": len(traps), "points": points}


def coverage(runs: int = 500, n_real: int = 30, n_traps: int = 20) -> dict:
    pool, rng = Pool(80, 300), random.Random(2)
    held = {}
    for name, strategy, skip in [("honest", "honest", 0), ("lazy", "lazy", 0), ("cheap", "cheap", 0), ("skimp 30%", "skimp", 0.3)]:
        held[name] = sum(pool.report(strategy, n_real, n_traps, rng, skip).receipt_held for _ in range(runs)) / runs
    return {"runs": runs, "confidence": checker.CONFIDENCE, "held": held}


def main(only: list[str] | None = None):
    parts = {"catch_curve": catch_curve, "quality_sweep": quality_sweep, "coverage": coverage}
    data = json.loads(OUT.read_text().split("=", 1)[1].rstrip().rstrip(";")) if OUT.exists() else {}
    for name, make in parts.items():
        if not only or name in only:
            data[name] = make()
    OUT.write_text("// Written by `python -m engine.odds`. Measured locally on Qiskit Aer.\nexport const ODDS = " + json.dumps(data, indent=1) + ";\n")
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    import sys

    main(sys.argv[1:] or None)
