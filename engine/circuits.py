"""Real job circuits and trap circuits, built on one mirror skeleton.

Every circuit is the same shape: a block U, a layer of X gates on some
qubits, then U undone. Same width, depth and gate set (RZ, SX, CX, X,
SXdg) for every circuit, so a server cannot sort them by their gates.

  trap     U uses Clifford angles (multiples of pi/2). A normal computer
           finds the answer exactly with a stabilizer simulation, so the
           customer knows it before sending the job.
  peaked   A real job whose angles sit near, but not on, Clifford angles.
           It has one most-likely answer, like Shor, Grover or phase
           estimation, but you need a quantum simulation to know it.
  flat     A real job with fully random angles. Its output is spread out,
           like a random-sampling job. Used to show the smart cheater
           winning when traps don't look like the real work.

Before sending, the customer Pauli-twirls every CX (randomized compiling).
Measured: without it, a machine's over-rotation errors partly cancel in
exact Clifford traps but not in real jobs, so traps died less often than
real answers went wrong and the receipt held in only 83-89% of runs.
Twirling turns those errors into random Pauli noise that hits every
circuit alike, which is what the receipt assumes.
"""

import math
import random
from dataclasses import dataclass, field

from qiskit import QuantumCircuit
from qiskit.circuit import pauli_twirl_2q_gates
from qiskit.quantum_info import StabilizerState, Statevector

N_QUBITS = 5
DEPTH = 3
HALF_PI = math.pi / 2

# Real peaked jobs: angle noise around Clifford points, and the smallest
# allowed share of the top answer. Kept close to a trap's 100% on purpose:
# if real jobs were blurrier than traps, a server could sort them by how
# sharp their output is (measured: that broke the receipt at PEAK_MIN 0.6).
PEAK_SIGMA = 0.12
PEAK_MIN = 0.9
# Flat jobs: no outcome may hold more than this share.
FLAT_MAX = 0.35


@dataclass
class JobCircuit:
    kind: str  # "trap", "peaked" or "flat"
    circuit: QuantumCircuit  # with measurements; what the server sees
    ideal: dict[str, float] = field(repr=False)  # noiseless output
    answer: str  # most likely outcome of the ideal output

    @property
    def is_trap(self) -> bool:
        return self.kind == "trap"


def _block(angles: list[list[tuple[float, float]]], n: int) -> QuantumCircuit:
    """U: DEPTH layers of RZ-SX-RZ on every qubit, then a staggered CX row."""
    block = QuantumCircuit(n)
    for layer, row in enumerate(angles):
        for q, (a, b) in enumerate(row):
            block.rz(a, q)
            block.sx(q)
            block.rz(b, q)
        for q in range(layer % 2, n - 1, 2):
            block.cx(q, q + 1)
    return block


def _mirror(angles, flips: list[int], n: int) -> QuantumCircuit:
    block = _block(angles, n)
    qc = QuantumCircuit(n)
    qc.compose(block, inplace=True)
    for q in flips:
        qc.x(q)
    qc.compose(block.inverse(), inplace=True)
    return qc


def _flips(rng: random.Random, n: int) -> list[int]:
    flips = [q for q in range(n) if rng.random() < 0.5]
    return flips or [rng.randrange(n)]


def _clifford_angle(rng: random.Random) -> float:
    return rng.randrange(4) * HALF_PI


def _top(probs: dict[str, float]) -> str:
    return max(probs, key=probs.get)


def _finish(kind: str, qc: QuantumCircuit, ideal: dict[str, float], rng: random.Random) -> JobCircuit:
    ideal = {str(k): float(v) for k, v in ideal.items() if v > 1e-9}
    measured = pauli_twirl_2q_gates(qc, twirling_gate="cx", seed=rng.getrandbits(32))
    measured.measure_all()
    return JobCircuit(kind=kind, circuit=measured, ideal=ideal, answer=_top(ideal))


def make_trap(rng: random.Random, n: int = N_QUBITS, depth: int = DEPTH) -> JobCircuit:
    angles = [[(_clifford_angle(rng), _clifford_angle(rng)) for _ in range(n)] for _ in range(depth)]
    qc = _mirror(angles, _flips(rng, n), n)
    # Classical computation only: this is what makes the answer known.
    return _finish("trap", qc, StabilizerState(qc).probabilities_dict(), rng)


def make_peaked(rng: random.Random, n: int = N_QUBITS, depth: int = DEPTH) -> JobCircuit:
    while True:
        angles = [
            [(_clifford_angle(rng) + rng.gauss(0, PEAK_SIGMA), _clifford_angle(rng) + rng.gauss(0, PEAK_SIGMA)) for _ in range(n)]
            for _ in range(depth)
        ]
        qc = _mirror(angles, _flips(rng, n), n)
        ideal = Statevector(qc).probabilities_dict()
        if max(ideal.values()) >= PEAK_MIN:
            return _finish("peaked", qc, ideal, rng)


def make_flat(rng: random.Random, n: int = N_QUBITS, depth: int = DEPTH) -> JobCircuit:
    while True:
        angles = [[(rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)) for _ in range(n)] for _ in range(depth)]
        qc = _mirror(angles, _flips(rng, n), n)
        ideal = Statevector(qc).probabilities_dict()
        if max(ideal.values()) <= FLAT_MAX:
            return _finish("flat", qc, ideal, rng)


def make_batch(n_real: int, n_traps: int, real_kind: str, rng: random.Random) -> list[JobCircuit]:
    """Real jobs and traps, shuffled together. The server only ever gets
    `[c.circuit for c in batch]`; which ones are traps stays with the customer."""
    make_real = {"peaked": make_peaked, "flat": make_flat}[real_kind]
    batch = [make_real(rng) for _ in range(n_real)] + [make_trap(rng) for _ in range(n_traps)]
    rng.shuffle(batch)
    return batch
