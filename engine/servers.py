"""Quantum clouds: one honest, four ways to cheat.

A server gets a list of circuits and a shot count, and returns one counts
dict per circuit. It never learns which circuits are traps. `cost` is the
share of the honest price the server actually spent, which is the reason
a provider would cheat.

All machines are simulated with qiskit-aer. The honest noise is set near
a current trapped-ion machine (IonQ Aria class). The cheap machine is ten
times noisier AND badly calibrated (its gates over-rotate). Random noise
alone almost never changes a circuit's top answer; miscalibration does.
Both machines are labelled "simulated" wherever they show.
"""

import random

from qiskit import QuantumCircuit
from qiskit.circuit.library import RXGate, RZXGate
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError, coherent_unitary_error, depolarizing_error

Counts = dict[str, int]


def noise_model(p1: float, p2: float, readout: float, over1: float = 0.0, over2: float = 0.0) -> NoiseModel:
    """Depolarizing noise `p1`/`p2` on 1- and 2-qubit gates, symmetric
    readout error, and optional over-rotation in radians (`over1` an extra
    RX after each SX, `over2` an extra RZX after each CX)."""
    e1, e2 = depolarizing_error(p1, 1), depolarizing_error(p2, 2)
    if over1:
        e1 = e1.compose(coherent_unitary_error(RXGate(over1).to_matrix()))
    if over2:
        e2 = e2.compose(coherent_unitary_error(RZXGate(over2).to_matrix()))
    model = NoiseModel()
    model.add_all_qubit_quantum_error(e1, ["sx", "sxdg"])
    model.add_all_qubit_quantum_error(depolarizing_error(p1, 1), ["x"])
    model.add_all_qubit_quantum_error(e2, ["cx"])
    model.add_all_qubit_readout_error(ReadoutError([[1 - readout, readout], [readout, 1 - readout]]))
    return model


GOOD_MACHINE = noise_model(p1=0.0005, p2=0.006, readout=0.004)
# Measured on 100 jobs + 100 traps: ~40% of real answers wrong, ~37% of traps dead.
CHEAP_MACHINE = noise_model(p1=0.005, p2=0.06, readout=0.04, over1=0.3, over2=0.5)


def _simulate(circuits: list[QuantumCircuit], shots: int, model: NoiseModel, seed: int) -> list[Counts]:
    if not circuits:
        return []
    sim = AerSimulator(noise_model=model, seed_simulator=seed)
    result = sim.run(circuits, shots=shots).result()
    return [dict(result.get_counts(i)) for i in range(len(circuits))]


def _random_counts(n_qubits: int, shots: int, rng: random.Random) -> Counts:
    counts: Counts = {}
    for _ in range(shots):
        key = format(rng.getrandbits(n_qubits), f"0{n_qubits}b")
        counts[key] = counts.get(key, 0) + 1
    return counts


class Server:
    name = ""
    blurb = ""
    cost = 1.0

    def __init__(self, seed: int = 0):
        self.seed = seed
        self.rng = random.Random(seed)

    def run(self, circuits: list[QuantumCircuit], shots: int) -> list[Counts]:
        raise NotImplementedError


class HonestServer(Server):
    name = "honest"
    blurb = "Runs every circuit on the good machine, every shot."

    def run(self, circuits, shots):
        return _simulate(circuits, shots, GOOD_MACHINE, self.seed)


class LazyServer(Server):
    name = "lazy"
    blurb = "Runs nothing. Sends back random bitstrings."
    cost = 0.0

    def run(self, circuits, shots):
        return [_random_counts(c.num_qubits, shots, self.rng) for c in circuits]


class CheapMachineServer(Server):
    name = "cheap"
    blurb = "Runs everything, but on a cheaper machine: noisier and badly calibrated."
    cost = 0.2

    def run(self, circuits, shots):
        return _simulate(circuits, shots, CHEAP_MACHINE, self.seed)


class SkimpServer(Server):
    """Runs a share `1 - skip` of the circuits properly and fakes the rest.
    It picks which to skip at random, because it can't see the traps."""

    name = "skimp"
    blurb = "Runs some circuits properly and fakes the rest."

    def __init__(self, seed: int = 0, skip: float = 0.3):
        super().__init__(seed)
        self.skip = skip
        self.cost = 1.0 - skip

    def run(self, circuits, shots):
        skipped = {i for i in range(len(circuits)) if self.rng.random() < self.skip}
        kept = [i for i in range(len(circuits)) if i not in skipped]
        real = dict(zip(kept, _simulate([circuits[i] for i in kept], shots, GOOD_MACHINE, self.seed)))
        return [real[i] if i in real else _random_counts(circuits[i].num_qubits, shots, self.rng) for i in range(len(circuits))]


class SmartCheaterServer(Server):
    """Tries to beat the traps by looking at the output.

    It runs every circuit for a few shots on the good machine (4% of the
    work). If one outcome dominates, it guesses "trap" and sends back that
    outcome dressed up as a full, clean run. If nothing dominates, it
    guesses "real work nobody can check" and sends random bitstrings.

    Against flat (sampling) jobs this fools the traps completely. Against
    jobs as sharp as the traps it can't sort them, so it has to answer
    every circuit properly, which is the point. It never reads the gates
    (see README: a server that does can spot Clifford angles; hiding them
    needs blind quantum computing).
    """

    name = "smart"
    blurb = "Peeks at each circuit with a few shots, polishes the ones that look like traps, fakes the rest."
    probe_shots = 40
    dominant = 0.4
    cost = 40 / 1000

    def run(self, circuits, shots):
        probes = _simulate(circuits, self.probe_shots, GOOD_MACHINE, self.seed)
        out = []
        for circuit, probe in zip(circuits, probes):
            top = max(probe, key=probe.get)
            if probe[top] / self.probe_shots >= self.dominant:
                out.append(self._polish(top, shots))
            else:
                out.append(_random_counts(circuit.num_qubits, shots, self.rng))
        return out

    def _polish(self, top: str, shots: int) -> Counts:
        """`top` at a believable share, the rest as one-bit-flip 'noise'."""
        counts = {top: int(shots * self.rng.uniform(0.9, 0.96))}
        for _ in range(shots - counts[top]):
            i = self.rng.randrange(len(top))
            flipped = top[:i] + ("1" if top[i] == "0" else "0") + top[i + 1 :]
            counts[flipped] = counts.get(flipped, 0) + 1
        return counts


STRATEGIES = {cls.name: cls for cls in (LazyServer, CheapMachineServer, SkimpServer, SmartCheaterServer)}
