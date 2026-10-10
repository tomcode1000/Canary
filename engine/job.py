"""One verification run: build the batch, send it, check the traps."""

import random
from dataclasses import dataclass

from . import checker, clouds
from .circuits import JobCircuit, make_batch
from .clouds import Counts


@dataclass
class CircuitResult:
    position: int
    kind: str
    counts: Counts
    answer: str  # what the cloud's result says
    expected: str  # trap: known answer; real job: the exact answer (ground truth)
    ok: bool  # trap: alive; real job: actually right


@dataclass
class JobReport:
    cloud: str
    blurb: str
    cost: float
    results: list[CircuitResult]
    receipt: checker.Receipt
    real_jobs: int
    actually_wrong: int  # ground truth from the simulation

    @property
    def actually_wrong_share(self) -> float:
        return self.actually_wrong / self.real_jobs if self.real_jobs else 0.0

    @property
    def receipt_held(self) -> bool:
        return self.actually_wrong_share <= self.receipt.max_wrong


def check(batch: list[JobCircuit], counts: list[Counts], cloud: str, cost: float) -> JobReport:
    results = []
    for i, (job, c) in enumerate(zip(batch, counts)):
        ok = checker.trap_passed(job, c) if job.is_trap else not checker.real_job_wrong(job, c)
        results.append(CircuitResult(i, job.kind, c, checker.top_answer(c), job.answer, ok))
    traps = [r for r in results if r.kind == "trap"]
    real = [r for r in results if r.kind != "trap"]
    return JobReport(
        cloud=cloud,
        blurb=clouds.BLURBS[cloud],
        cost=cost,
        results=results,
        receipt=checker.receipt(sum(not r.ok for r in traps), len(traps), len(real)),
        real_jobs=len(real),
        actually_wrong=sum(not r.ok for r in real),
    )


@dataclass
class Executed:
    """A batch and everything the backend returned for it, in one job."""

    batch: list[JobCircuit]
    honest: list[Counts]
    cheap: list[Counts]
    shots: int
    seed: int

    def report(self, strategy: str, skip: float = 0.3, keep: list[int] | None = None) -> JobReport:
        """`keep`: positions to include (e.g. fewer traps); default all."""
        idx = keep if keep is not None else list(range(len(self.batch)))
        counts = clouds.respond(strategy, [self.honest[i] for i in idx], [self.cheap[i] for i in idx], self.seed, skip)
        return check([self.batch[i] for i in idx], counts, strategy, clouds.cost(strategy, self.shots, skip))


def execute_batches(backend, batches: list[list[JobCircuit]], shots: int, seed: int, with_cheap: list[bool]) -> list[Executed]:
    """Send every batch, and the miscalibrated copies the cheap cloud needs,
    to the backend as one job."""
    circuits, spans = [], []
    for batch, cheap in zip(batches, with_cheap):
        start = len(circuits)
        circuits += [j.circuit for j in batch]
        if cheap:
            circuits += [clouds.miscalibrate(j.circuit) for j in batch]
        spans.append((start, len(batch), cheap))
    counts = clouds.execute(backend, circuits, shots)
    out = []
    for batch, (start, n, cheap) in zip(batches, spans):
        honest = counts[start : start + n]
        out.append(Executed(batch, honest, counts[start + n : start + 2 * n] if cheap else honest, shots, seed))
    return out


def run_job(backend, n_real: int = 30, n_traps: int = 20, shots: int = 1000, real_kind: str = "peaked", seed: int = 0) -> Executed:
    batch = make_batch(n_real, n_traps, real_kind, random.Random(seed))
    return execute_batches(backend, [batch], shots, seed, [True])[0]
