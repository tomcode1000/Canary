// Qollab entry point (a JS / Qiskit project). The quantum work is Python
// in engine/bridge.py; `backend` is the machine picked in Select QPU.
import * as bridge from 'engine.bridge';
import { start } from './ui.js';
import { ODDS } from './odds.js';

const call = async (fn, kwargs = {}) => JSON.parse(await fn.callPromisingKwargs(kwargs));

start(
  {
    build: (seed) => call(bridge.build, { seed }),
    layout: (n_traps) => call(bridge.layout, { n_traps }),
    send: (shots) => call(bridge.send, { backend, shots }),
    report: (strategy, n_traps, skip) => call(bridge.report, { strategy, n_traps, skip }),
    smart: (real_kind) => call(bridge.smart, { real_kind }),
  },
  ODDS,
);
