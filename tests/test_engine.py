import random

import pytest
from qiskit.quantum_info import Statevector

from engine import checker
from engine.circuits import FLAT_MAX, PEAK_MIN, make_batch, make_flat, make_peaked, make_trap
from engine.job import run_job
from engine.servers import HonestServer, LazyServer, SmartCheaterServer


def _unmeasured(job):
    return job.circuit.remove_final_measurements(inplace=False)


def test_trap_answer_is_certain_and_matches_full_simulation():
    rng = random.Random(1)
    for _ in range(50):
        trap = make_trap(rng)
        assert trap.ideal == {trap.answer: pytest.approx(1.0)}
        probs = Statevector(_unmeasured(trap)).probabilities_dict()
        assert probs[trap.answer] == pytest.approx(1.0)


def test_real_jobs_have_the_promised_shape():
    rng = random.Random(2)
    assert all(max(make_peaked(rng).ideal.values()) >= PEAK_MIN for _ in range(30))
    assert all(max(make_flat(rng).ideal.values()) <= FLAT_MAX for _ in range(30))


PAULIS = {"x", "y", "z", "id"}  # random: the secret flips and the twirl


def test_traps_look_like_real_jobs():
    """Same width and the same non-Pauli gates; only the angles differ."""
    rng = random.Random(3)
    trap, real = make_trap(rng), make_peaked(rng)
    a, b = trap.circuit, real.circuit
    assert a.num_qubits == b.num_qubits
    strip = lambda c: {k: v for k, v in c.count_ops().items() if k not in PAULIS}
    assert strip(a) == strip(b)


def test_twirling_keeps_every_answer():
    rng = random.Random(9)
    for job in [make_trap(rng) for _ in range(10)] + [make_peaked(rng) for _ in range(10)]:
        probs = Statevector(_unmeasured(job)).probabilities_dict()
        assert probs[job.answer] == pytest.approx(job.ideal[job.answer], abs=1e-6)


def test_batch_shuffles_traps_in():
    batch = make_batch(30, 20, "peaked", random.Random(4))
    kinds = [j.kind for j in batch]
    assert kinds.count("trap") == 20 and kinds.count("peaked") == 30
    assert kinds != sorted(kinds)


def test_bound_with_no_dead_traps_matches_hand_calculation():
    # 20 traps, 30 real: P(no trap among 5 wrong) = 0.067 > 5%, among 6 = 0.037.
    assert checker.wrong_share_bound(0, 20, 30) == pytest.approx(5 / 30)


def test_bound_grows_with_failures_and_shrinks_with_traps():
    bounds = [checker.wrong_share_bound(f, 20, 30) for f in range(21)]
    assert bounds == sorted(bounds) and bounds[-1] == 1.0
    assert checker.wrong_share_bound(0, 40, 30) < checker.wrong_share_bound(0, 10, 30)


def test_honest_server_passes_and_cheaters_are_caught():
    _, (honest, lazy) = run_job([HonestServer(5), LazyServer(5)], seed=5)
    assert not honest.receipt.caught and honest.actually_wrong == 0
    assert lazy.receipt.caught and lazy.receipt.failed >= 15


def test_smart_cheater_fools_traps_only_when_jobs_look_different():
    _, (flat,) = run_job([SmartCheaterServer(6)], real_kind="flat", seed=6)
    assert not flat.receipt.caught and flat.actually_wrong_share == 1.0
    _, (peaked,) = run_job([SmartCheaterServer(6)], real_kind="peaked", seed=6)
    assert not peaked.receipt.caught and peaked.actually_wrong == 0
