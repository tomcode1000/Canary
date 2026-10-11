// Vercel entry point: the same page, calling the engine's serverless API
// (api/index.py). It only starts on a vercel.app address, so it does
// nothing on Qollab (main.js) or locally (local.js). Every call carries the
// seed and shots, because serverless instances don't remember earlier ones.
import { start } from './ui.js';
import { ODDS } from './odds.js';

if (location.hostname.endsWith('vercel.app')) {
  let seed = 1, shots = 300;
  const get = async (name, params = {}) => {
    const res = await fetch(`/api/${name}?${new URLSearchParams({ seed, shots, ...params })}`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    return res.json();
  };
  start(
    {
      build: (s) => ((seed = s), get('build')),
      layout: (n_traps) => get('layout', { n_traps }),
      send: (s) => ((shots = s), get('send')),
      report: (strategy, n_traps, skip) => get('report', { strategy, n_traps, skip }),
      smart: (real_kind) => get('smart', { real_kind }),
    },
    ODDS,
  );
}
