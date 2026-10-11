# Canary

**The whole point of a quantum computer is that you can't check its answer. Canary shows how you catch a quantum cloud that cheats anyway.**

Quantum computers are rented over the cloud. A provider could quietly run a cheaper machine, skip part of your job, or return made-up numbers, and no normal computer can redo the work to find out. Canary hides **traps** inside your job: circuits that look like the rest but whose answer you already know. It then turns the traps into a **receipt**:

> PASSED — all 20 traps alive. At least 83% of your answers are right (95% confidence).
>
> CAUGHT — 12 of 20 traps dead. Up to 83% of your answers may be wrong (95% confidence).

A buyer can act on a receipt. Nobody can act on "trust us".

Track: **Quantum Unlocked** (algorithms). Built for the Qollab × IonQ Global Quantum Hackathon, 9–11 Oct 2026.

---

## Run it

**Live:** https://canary-nu-eight.vercel.app (the same page, with the engine as a serverless function on Qiskit's BasicSimulator).

**On Qollab:** press **Run** and pick any backend. The built-in simulator is instant; IonQ's remote simulators run the same job under IonQ's own noise model. Canary sends every circuit it needs (honest run, the cheap machine's run, both batches, 170 circuits) as **one job**, because IonQ allows one job per run. Everything after that, including every slider, only re-reads those results.

**Locally:**

```bash
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m engine.dev_server                          # open http://127.0.0.1:8000
```

It uses Qiskit's BasicSimulator (seeded), like Qollab's built-in simulator; add `aer` to use Qiskit Aer. The charts come from `odds.js`, which ships with the repo; `python -m engine.odds` measures it again (about a minute). Tests: `python -m pytest`.

## What you do on the page

The page opens on a five-section landing page. Its background is a cloud of dots, one per measurement shot, that drifts like noise, gathers into the canary, and scatters again: random shots becoming an answer you can trust. **Open the console** to play. The console has four views:

1. **Your job.** 30 real circuits. Choose how many traps to hide and how cloud B cheats: *lazy* (random answers), *cheap machine* (noisier and badly calibrated), or *skimps* (fakes a share of the circuits).
2. **Two clouds run it.** Cloud A is the real backend you picked. Cloud B cheats on top of that same backend. Both get the same shuffled circuits. Canary checks only the traps and writes a receipt for each cloud. Then **Reveal the truth**: only a simulation can compare every real answer with the exact one, so you can see whether each receipt told the truth.
3. **How many traps is enough?** Catch odds against traps (theory and measured), the receipt's worst case, and the share of your bill spent on checks. Next to it, measured proof that dead traps track wrong answers.
4. **Round 2: the smart cheater.** It peeks at every circuit with a few shots and polishes whatever looks like a trap. Against sampling jobs it **fools the traps completely**. Against answer jobs it can't tell them apart, so it has to get every answer right.

## How it works

### One skeleton for every circuit

Every circuit (5 qubits) is a block **U**, a layer of X gates on random qubits, then **U⁻¹**. U is three layers of `RZ·SX·RZ` on each qubit plus a staggered row of CX gates. Same width, same depth, same gate set for every circuit. Only the angles differ:

| Kind | Angles | Answer |
|---|---|---|
| **Trap** | multiples of π/2, so every gate is Clifford | U⁻¹·X·U is a Pauli, so the output is one known bitstring. A laptop finds it with a stabilizer simulation (`StabilizerState`), no quantum simulation needed. |
| **Answer job** (real) | near Clifford points, plus Gaussian noise (σ = 0.12) | One most-likely answer (≥ 90% of the output), like Shor, Grover or phase estimation, but you need a quantum simulation to know which. |
| **Sampling job** (real, Round 2) | uniform random | Spread out: no outcome above 35%. |

The customer shuffles traps among the real jobs and **Pauli-twirls every CX** (randomized compiling) before sending. The server sees only circuits.

### Checking a trap

A circuit's answer is its most frequent outcome. A trap **dies** when that is not the answer the customer computed in advance. There's no threshold to tune: an honest but noisy machine still gets the top answer right, so it is never accused.

### The receipt

If the server can't tell traps from real jobs, the traps are a **uniformly random sample** of the batch's positions. So if *W* of the *N* circuits came back wrong, the number of dead traps follows a hypergeometric distribution. Canary rules out every *W* for which seeing *f* or fewer dead traps would happen less than 5% of the time. The receipt is the largest *W* that's left, minus the dead traps, as a share of the real jobs. This is the accreditation idea of Ferracin, Kapourniotis and Datta (2019), written for one finite batch.

With 30 real jobs and no dead traps:

| Traps | 5 | 10 | 20 | 40 |
|---|---|---|---|---|
| Worst case wrong | 47% | 30% | 17% | 10% |
| Share of bill on traps | 14% | 25% | 40% | 57% |

Catch odds against a cloud that fakes a share *q* of the circuits: **P(caught) = 1 − (1 − q·(1 − 2⁻ⁿ))ᵗ**. The 2⁻ⁿ term is the chance that a faked trap's random answer happens to be right.

## What building it taught us (measured, not assumed)

Each of these came from a measurement that disagreed with the first design.

**1. Noise doesn't change answers. Miscalibration does.** Making the cheap machine 10× (even 30×) noisier with random noise left 0–2% of answers wrong, because random noise spreads evenly over all outcomes and the top answer survives. What turns answers wrong is a machine whose gates consistently **over-rotate**. So the cheap machine is noisier *and* badly calibrated, which is also how real hardware tends to go bad: drift.

**2. A trap must look like the work, including its output.** In a first version, real jobs had a top answer of 60–100% while traps always had 100%. A cheater that peeked at the output could sort them, and the receipt said "at most 56% wrong" when 77% were. Making answer jobs as sharp as traps (≥ 90%) closed that. Round 2 on the page keeps the broken case on purpose: against sampling jobs, the smart cheater keeps every trap alive while 100% of real results are junk.

**3. Bound this batch, not the machine's long-run rate.** The first receipt was a Clopper–Pearson bound on the server's error *rate*. Over 200 runs it held only 75–91% of the time for the 30 answers actually delivered, because the realized share wobbles around the rate. The hypergeometric bound on the batch itself fixed that.

**4. Coherent errors treat traps and real jobs differently, and randomized compiling fixes it.** Even with matching shapes, over-rotation errors partly cancel inside exact-Clifford traps but not inside near-Clifford real jobs. Traps died less often than answers went wrong (at 0.4 rad: 71% against 80%), and the receipt held in only 89% of cheap-machine runs. Pauli-twirling every CX turns coherent errors into random Pauli noise that hits every circuit alike. Afterwards (ideal simulator plus the cheap machine's over-rotation and readout flips; 100 real jobs, 100 traps, 300 shots):

| Over-rotation (rad: SX; CX × 5/3) | 0.2 | 0.25 | 0.3 | 0.35 | 0.4 | 0.45 | 0.5 |
|---|---|---|---|---|---|---|---|
| Real answers actually wrong | 2% | 10% | 32% | 59% | 76% | 85% | 95% |
| Traps dead | 2% | 15% | 39% | 59% | 72% | 85% | 92% |

**Does the receipt hold?** 500 runs per cloud, 30 real jobs and 20 traps each, 95% receipt:

| Cloud | Honest | Lazy | Cheap machine | Skimps 30% |
|---|---|---|---|---|
| Receipt held | 100% | 99.8% | 99.6% | 98.4% |

**Catch odds, theory against measurement** (cloud fakes 10% of circuits, 200 runs per point):

| Traps | 1 | 2 | 4 | 8 | 12 | 16 | 24 | 32 |
|---|---|---|---|---|---|---|---|---|
| Theory | 10% | 18% | 33% | 56% | 71% | 80% | 91% | 96% |
| Measured | 15% | 22% | 32% | 59% | 69% | 82% | 94% | 97% |

## What Canary is not

- **Not full verification.** It's spot-checking with hidden traps plus a statistical receipt. The receipt is valid only while the server can't tell traps from real jobs.
- **A server that reads the gate angles can spot the traps.** Clifford angles are multiples of π/2. Hiding them needs **blind quantum computing** (Broadbent, Fitzsimons & Kashefi 2009; Fitzsimons & Kashefi 2017). Checking a quantum computer with only a classical computer needs **Mahadev's protocol** (2018). Canary's smart cheater only looks at outputs, and Round 2 shows that's already enough to win when the disguise is weak.
- **The cheating clouds are simulated on top of the real backend.** The honest cloud is whatever backend you pick. The "cheap machine" runs the same circuits with extra over-rotation gates (0.3 rad RX after every SX, 0.5 rad RZX after every CX) and flips 4% of readout bits. These numbers are illustrative, not a measurement of any vendor.
- **5 qubits.** At this size everything is classically simulable, which is what lets the page reveal the truth. The real jobs stand in for jobs too big to check.

## Related work

- J. F. Fitzsimons, E. Kashefi, *Unconditionally verifiable blind quantum computation*, Phys. Rev. A 96, 012303 (2017).
- S. Barz et al., *Experimental verification of quantum computation*, Nature Physics 9, 727 (2013).
- S. Ferracin, T. Kapourniotis, A. Datta, *Accrediting outputs of noisy intermediate-scale quantum computing devices*, New J. Phys. 21, 113038 (2019).
- U. Mahadev, *Classical verification of quantum computations*, FOCS 2018.
- T. Proctor et al., *Measuring the capabilities of quantum computers* (mirror circuits), Nature Physics 18, 75 (2022).
- J. J. Wallman, J. Emerson, *Noise tailoring for scalable quantum computation via randomized compiling*, Phys. Rev. A 94, 052325 (2016).
- **Trapify** by VeriQloud (trapify.veriqloud.fr): a real tool that adds traps to your own QASM circuits. Canary is the playable customer's-eye explanation of why that works, and when it doesn't.

## Built with, and disclosures

- **Qiskit 2.5** (circuits, `StabilizerState`, `Statevector`, `pauli_twirl_2q_gates`) and **Qiskit Aer 0.17** (noisy simulation).
- On Qollab it runs as a **JS / Qiskit project**: `main.js` imports the Python bridge (`engine/bridge.py`) and passes it the backend you picked. Locally, **FastAPI** and **Uvicorn** serve the same page. The page is plain HTML, CSS and JavaScript with hand-drawn SVG charts, no front-end framework. Fonts: IBM Plex via Google Fonts.
- **AI assistance:** written with Claude Code (Anthropic) as a pair programmer during the hackathon window. The design, the measurements and the findings were checked by running the code.
- No templates or starter code. All project code was written inside the build window (9 Oct 19:00 ET – 11 Oct 19:00 ET).

## Layout

```
index.html main.css   the page (Qollab runs a top-level index.html + main.js)
main.js               Qollab entry: imports engine.bridge, passes it `backend`
local.js              local entry: same page over engine/dev_server.py
ui.js                 all drawing; odds.js = measured chart data
engine/circuits.py    trap, answer-job and sampling-job circuits (one skeleton) + twirling
engine/clouds.py      honest backend, and the lazy / cheap / skimp / smart cheaters on top of it
engine/checker.py     trap check, ground truth, the receipt bound
engine/job.py         one job per run, then reports per cloud
engine/bridge.py      what the page calls (JSON)
engine/odds.py        catch curve, calibration sweep, receipt coverage -> odds.js
tests/                pytest
```

MIT licensed. © 2026 Tolulope Filade.
