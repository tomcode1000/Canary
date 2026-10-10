// Local entry point: the same page, talking to engine/dev_server.py.
import { start } from './ui.js';
import { ODDS } from './odds.js';

async function get(name, params = {}) {
  const res = await fetch(`/api/${name}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  return res.json();
}

start(
  {
    build: (seed) => get('build', { seed }),
    layout: (n_traps) => get('layout', { n_traps }),
    send: (shots) => get('send', { shots }),
    report: (strategy, n_traps, skip) => get('report', { strategy, n_traps, skip }),
    smart: (real_kind) => get('smart', { real_kind }),
  },
  ODDS,
);
