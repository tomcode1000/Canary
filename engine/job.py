"""One verification run: build the batch, send it, check the traps."""

import random
from dataclasses import dataclass

from . import checker
from .circuits import JobCircuit, make_batch
from .servers import Counts, Server


@dataclass
class CircuitResult:
    position: int
    kind: str
    counts: Counts
    answer: str  # what the server's result says
    expected: str  # trap: known answer; real job: the ideal answer (ground truth)
    ok: bool  # trap: alive; real job: actually right


@dataclass
class JobReport:
    server: str
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


def check(batch: list[JobCircuit], counts: list[Counts], server: Server) -> JobReport:
    results = []
    for i, (job, c) in enumerate(zip(batch, counts)):
        ok = checker.trap_passed(job, c) if job.is_trap else not checker.real_job_wrong(job, c)
        results.append(CircuitResult(i, job.kind, c, checker.top_answer(c), job.answer, ok))
    traps = [r for r in results if r.kind == "trap"]
    real = [r for r in results if r.kind != "trap"]
    return JobReport(
        server=server.name,
        blurb=server.blurb,
        cost=server.cost,
        results=results,
        receipt=checker.receipt(sum(not r.ok for r in traps), len(traps), len(real)),
        real_jobs=len(real),
        actually_wrong=sum(not r.ok for r in real),
    )


def run_job(
    servers: list[Server], n_real: int = 30, n_traps: int = 20, shots: int = 1000, real_kind: str = "peaked", seed: int = 0
) -> tuple[list[JobCircuit], list[JobReport]]:
    """Send the same batch to every server. Each sees only the circuits."""
    batch = make_batch(n_real, n_traps, real_kind, random.Random(seed))
    circuits = [job.circuit for job in batch]
    return batch, [check(batch, server.run(circuits, shots), server) for server in servers]
