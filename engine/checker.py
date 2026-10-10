"""Check the traps and write the receipt.

A circuit's answer is its most frequent outcome. A trap fails (the canary
dies) when its answer is not the one the customer computed in advance.
No threshold to tune: an honest but noisy machine still gets the top
answer right, so it is not accused.

The receipt turns f dead traps out of t into a bound on THIS batch's
real answers. If the server can't tell traps from real jobs, the traps
are a uniformly random sample of the batch's positions. So if W of the
N circuits came back wrong, the dead traps follow a hypergeometric
distribution, and any W that would make seeing f or fewer dead traps
less likely than 5% is ruled out. The bound is the largest W left,
minus the dead traps, over the real jobs. This is the accreditation idea
(Ferracin, Kapourniotis, Datta 2019), written for a finite batch.

(A first version bounded the server's long-run error RATE instead
(Clopper-Pearson). Measured over 200 runs it held only 75-90% of the time
for these 30 answers, because the realised share wobbles around the rate.)
"""

import math
from dataclasses import dataclass

from .circuits import JobCircuit

CONFIDENCE = 0.95

# A flat (sampling) job has no single answer; its result counts as wrong
# when its distribution is this far (total variation) from the ideal one.
FLAT_TVD_LIMIT = 0.25


def top_answer(counts: dict[str, int]) -> str:
    return max(counts, key=counts.get)


def tvd(counts: dict[str, int], ideal: dict[str, float]) -> float:
    shots = sum(counts.values())
    keys = set(counts) | set(ideal)
    return 0.5 * sum(abs(counts.get(k, 0) / shots - ideal.get(k, 0.0)) for k in keys)


def trap_passed(trap: JobCircuit, counts: dict[str, int]) -> bool:
    return top_answer(counts) == trap.answer


def real_job_wrong(job: JobCircuit, counts: dict[str, int]) -> bool:
    """Ground truth, which only the simulation knows. Never used by the
    verdict; shown next to the receipt to prove whether the receipt held."""
    if job.kind == "flat":
        return tvd(counts, job.ideal) > FLAT_TVD_LIMIT
    return top_answer(counts) != job.answer


def _hypergeom_cdf(failed: int, total: int, wrong: int, traps: int) -> float:
    """P(at most `failed` of `traps` sampled circuits are among the `wrong`)."""
    return sum(math.comb(wrong, k) * math.comb(total - wrong, traps - k) for k in range(failed + 1)) / math.comb(total, traps)


def wrong_share_bound(failed: int, traps: int, n_real: int, confidence: float = CONFIDENCE) -> float:
    """Largest share of the `n_real` real answers that can be wrong while
    still being consistent with `failed` dead traps out of `traps`."""
    if n_real == 0:
        return 0.0
    if traps == 0:
        return 1.0
    total = traps + n_real
    worst = failed
    for wrong in range(failed, total - (traps - failed) + 1):
        if _hypergeom_cdf(failed, total, wrong, traps) <= 1 - confidence:
            break
        worst = wrong
    return min(worst - failed, n_real) / n_real


@dataclass
class Receipt:
    traps: int
    failed: int
    confidence: float
    max_wrong: float  # bound on the share of wrong real answers

    @property
    def caught(self) -> bool:
        return self.failed > 0

    @property
    def min_right(self) -> float:
        return 1.0 - self.max_wrong

    def line(self) -> str:
        conf = f"({self.confidence:.0%} confidence)"
        if not self.caught:
            return f"PASSED - all {self.traps} traps alive. At least {self.min_right:.0%} of your answers are right {conf}."
        return f"CAUGHT - {self.failed} of {self.traps} traps dead. Up to {self.max_wrong:.0%} of your answers may be wrong {conf}."


def receipt(failed: int, traps: int, n_real: int, confidence: float = CONFIDENCE) -> Receipt:
    return Receipt(traps, failed, confidence, wrong_share_bound(failed, traps, n_real, confidence))
