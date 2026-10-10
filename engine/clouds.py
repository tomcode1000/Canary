"""Quantum clouds: one honest, four ways to cheat.

The honest cloud is a real backend: whatever machine you pick when you
press Run on Qollab (Qiskit's built-in simulator, an IBM noise model,
IonQ's simulators or IonQ hardware), or Qiskit Aer locally. Each
cheating cloud is built on top of that same backend:

  lazy     runs nothing; sends back random bitstrings
  cheap    runs a miscalibrated machine: every SX over-rotates (an extra
           RX) and every CX over-rotates (an extra RZX), and readout bits
           flip more often. Random noise alone almost never changes a
           circuit's top answer; miscalibration does (see README).
  skimp    runs a share of the circuits properly and fakes the rest; it
           picks at random because it can't see the traps
  smart    peeks at each circuit with a few shots, polishes whatever looks
           like a trap and fakes the rest

IonQ backends accept one job per run, so every circuit any cloud needs
goes to the backend in ONE `backend.run` call (see `execute`). After that
the clouds only post-process counts, so sliders on the page are instant.

`cost` is the share of the honest price a cloud actually spent, which is
why a provider would cheat.
"""

import random

from qiskit import QuantumCircuit, transpile

Counts = dict[str, int]

# Cheap machine. Over-rotation in radians after each SX/SXdg (RX) and each
# CX (RZX), and the chance a readout bit flips.
CHEAP_OVER_SX = 0.3
CHEAP_OVER_CX = 0.5
CHEAP_READOUT = 0.04

PROBE_SHOTS = 40  # what the smart cheater spends per circuit
DOMINANT = 0.4  # a top answer above this share looks like a trap to it

BLURBS = {
    "honest": "Runs every circuit on the machine you picked, every shot.",
    "lazy": "Runs nothing. Sends back random bitstrings.",
    "cheap": "Runs everything, but on a cheaper machine: badly calibrated, noisier readout.",
    "skimp": "Runs some circuits properly and fakes the rest.",
    "smart": "Peeks at each circuit with a few shots, polishes the ones that look like traps, fakes the rest.",
}


def cost(strategy: str, shots: int, skip: float = 0.0) -> float:
    return {"honest": 1.0, "lazy": 0.0, "cheap": 0.2, "skimp": 1.0 - skip, "smart": min(1.0, PROBE_SHOTS / shots)}[strategy]


def miscalibrate(circuit: QuantumCircuit, over_sx: float = CHEAP_OVER_SX, over_cx: float = CHEAP_OVER_CX) -> QuantumCircuit:
    """The same circuit as a badly calibrated machine would execute it."""
    out = circuit.copy_empty_like()
    for inst in circuit.data:
        out.append(inst)
        name = inst.operation.name
        if name in ("sx", "sxdg") and over_sx:
            out.rx(over_sx, inst.qubits[0])
        elif name == "cx" and over_cx:
            out.rzx(over_cx, *inst.qubits)
    return out


def execute(backend, circuits: list[QuantumCircuit], shots: int) -> list[Counts]:
    """Compile for the backend without optimising (so nothing cancels the
    mirror structure away) and run everything as one job."""
    if not circuits:
        return []
    compiled = transpile(circuits, backend=backend, optimization_level=0, seed_transpiler=0)
    result = backend.run(compiled, shots=shots).result()
    return [{str(k): int(v) for k, v in result.get_counts(i).items()} for i in range(len(circuits))]


def random_counts(n_qubits: int, shots: int, rng: random.Random) -> Counts:
    counts: Counts = {}
    for _ in range(shots):
        key = format(rng.getrandbits(n_qubits), f"0{n_qubits}b")
        counts[key] = counts.get(key, 0) + 1
    return counts


def _shots(counts: Counts) -> list[str]:
    return [k for k, v in counts.items() for _ in range(v)]


def flip_readout(counts: Counts, p: float, rng: random.Random) -> Counts:
    out: Counts = {}
    for bits in _shots(counts):
        key = "".join(("1" if b == "0" else "0") if rng.random() < p else b for b in bits)
        out[key] = out.get(key, 0) + 1
    return out


def subsample(counts: Counts, k: int, rng: random.Random) -> Counts:
    """What the backend would have returned with only `k` shots."""
    out: Counts = {}
    for bits in rng.sample(_shots(counts), min(k, sum(counts.values()))):
        out[bits] = out.get(bits, 0) + 1
    return out


def polish(top: str, shots: int, rng: random.Random) -> Counts:
    """`top` at a believable share; the rest as one-bit-flip 'noise'."""
    counts = {top: int(shots * rng.uniform(0.9, 0.96))}
    for _ in range(shots - counts[top]):
        i = rng.randrange(len(top))
        flipped = top[:i] + ("1" if top[i] == "0" else "0") + top[i + 1 :]
        counts[flipped] = counts.get(flipped, 0) + 1
    return counts


def respond(strategy: str, honest: list[Counts], cheap: list[Counts], seed: int, skip: float = 0.3) -> list[Counts]:
    """What each cloud sends back, given the honest backend's counts and
    the miscalibrated run's counts for the same circuits.

    Every random choice is seeded per circuit, so moving a slider changes
    only what that slider controls."""
    out = []
    for i, h in enumerate(honest):
        rng = random.Random(f"{strategy}-{seed}-{i}")
        n_qubits, shots = len(next(iter(h))), sum(h.values())
        if strategy == "honest":
            out.append(h)
        elif strategy == "lazy":
            out.append(random_counts(n_qubits, shots, rng))
        elif strategy == "cheap":
            out.append(flip_readout(cheap[i], CHEAP_READOUT, rng))
        elif strategy == "skimp":
            # One draw per circuit: raising `skip` only ever adds faked circuits.
            out.append(random_counts(n_qubits, shots, rng) if rng.random() < skip else h)
        elif strategy == "smart":
            probe = subsample(h, PROBE_SHOTS, rng)
            top = max(probe, key=probe.get)
            looks_like_trap = probe[top] / sum(probe.values()) >= DOMINANT
            out.append(polish(top, shots, rng) if looks_like_trap else random_counts(n_qubits, shots, rng))
        else:
            raise ValueError(f"unknown strategy {strategy!r}")
    return out


STRATEGIES = ["lazy", "cheap", "skimp", "smart"]
