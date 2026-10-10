import { startDots } from "./landing.js";

// The page. Everything quantum happens in Python (engine/bridge.py); this
// file only draws. `start(api, odds)` is called by main.js on Qollab and by
// local.js on the dev server, each passing the same api:
//   build(seed) layout(nTraps) send(shots) report(strategy, nTraps, skip) smart(kind)

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pct = (x) => `${Math.round(x * 100)}%`;
// For measured shares near 100%, where rounding would overstate them.
const pct1 = (x) => (x >= 1 ? "100%" : `${(Math.floor(x * 1000) / 10).toFixed(1)}%`);
const N_REAL = 30;
const PROBE_SHOTS = 40; // engine/clouds.py PROBE_SHOTS
const NAMES = { honest: "Honest", lazy: "Lazy", cheap: "Cheap machine", skimp: "Skimps", smart: "Smart cheater" };
const BLURBS = {
  lazy: "Runs nothing. Sends back random bitstrings.",
  cheap: "Runs everything on a cheaper machine: badly calibrated, noisier readout.",
  skimp: "Runs some circuits properly and fakes the rest.",
};
const icon = (id) => `<svg class="i"><use href="#${id}"/></svg>`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { traps: 20, strategy: "cheap", skip: 0.3, seed: 1, shots: 300, sent: null, odds: null, api: null, revealed: false, smartKind: null };

/* ---------- Views ---------- */

function showView(name) {
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  $$(".side button").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  window.scrollTo(0, 0);
}

function showConsole(on) {
  $("#landing").hidden = on;
  $("#console").hidden = !on;
  window.scrollTo(0, 0);
}

/* ---------- Landing ---------- */

function fillLanding(built) {
  // An illustration of a batch: 40 tasks, 12 of them traps.
  const traps = new Set([2, 5, 9, 13, 16, 21, 24, 28, 31, 33, 36, 39]);
  $("#solGrid").innerHTML = Array.from({ length: 40 }, (_, i) => (traps.has(i) ? `<span class="cell trap">${icon("bird")}</span>` : `<span class="cell"></span>`)).join("");
  if (built) $("#qasm").textContent = built.qasm.split("\n").slice(0, 40).join("\n") + "\n…";
  const cov = state.odds.coverage;
  const held = Object.values(cov.held);
  const lo = pct1(Math.min(...held)), hi = pct1(Math.max(...held));
  $("#proofLede").textContent = `Canary turns hidden traps into a receipt you can check. We attacked it with four kinds of cloud, ${cov.runs} runs each, and compared every receipt with the real outcome.`;
  $("#proofCallout").textContent = `The receipt held in ${lo}–${hi} of ${cov.runs} runs per cloud.`;
  $("#coverageSub").textContent = `${cov.runs} runs per cloud`;
  const about = { honest: ["i-shield", "Runs every circuit properly."], lazy: ["i-cloud", "Sends back random answers."], cheap: ["i-chip", "Uses a badly calibrated machine."], "skimp 30%": ["i-receipt", "Fakes 30% of the circuits."] };
  $("#coverageRows").innerHTML = Object.entries(cov.held)
    .map(([k, v]) => `<div><span class="tile tile-sm">${icon(about[k][0])}</span><div class="grow"><b>${k[0].toUpperCase() + k.slice(1)}</b><span>${about[k][1]}</span></div><div class="num">${pct1(v)}<span>receipt held</span></div></div>`)
    .join("");
  const pts = state.odds.quality_sweep.points;
  lineChart($("#landingSweep"), sweepSpec(pts));
}

/* ---------- Your job ---------- */

async function showLayout() {
  const cells = await state.api.layout(state.traps);
  $("#batch").innerHTML = cells
    .map((c) => (c.kind === "trap" ? `<div class="cell trap${state.sent ? " hidden-trap" : ""}" data-tip="Trap · you know its answer: ${c.expected}">${icon("bird")}</div>` : `<div class="cell" data-tip="Real task"></div>`))
    .join("");
  updateJobText();
}

function updateJobText() {
  const sent = !!state.sent;
  const share = state.traps / (N_REAL + state.traps);
  $("#batchMeta").textContent = `${state.traps} traps · ${state.shots} shots · ${NAMES[state.strategy]}${state.strategy === "skimp" ? ` (${pct(state.skip)})` : ""}`;
  $("#batchKv").innerHTML = [
    [`<span class="cell trap cell-xs">${icon("bird")}</span>Traps hidden`, `${state.traps}`],
    [`<span class="cell cell-xs"></span>Real tasks`, `${N_REAL}`],
    ["Bill on traps", pct(share)],
  ]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
  $("#jobEyebrow").textContent = sent ? "Your job" : "Configure your job";
  $("#jobTitle").innerHTML = sent ? "Job <em>sent.</em>" : "Your <em>job.</em>";
  $("#jobLede").textContent = sent
    ? "The traps are hidden and the whole job ran as one batch on the backend you picked. The cloud saw the same circuit shape for every task."
    : "Set how many traps to hide, choose how cloud B cheats, and send the job. Canary hides the traps and checks them when the results come back.";
  $("#sees").hidden = !sent;
  $("#seesCount").textContent = `${N_REAL + state.traps} circuits with the same shape.`;
}

function updateControls() {
  $("#trapsOut").textContent = state.traps;
  $("#traps2Out").textContent = state.traps;
  $("#traps").value = state.traps;
  $("#traps2").value = state.traps;
  const share = state.traps / (N_REAL + state.traps);
  $("#trapsCost").textContent = state.traps ? `${pct(share)} of what you pay goes on checks.` : "No traps: nothing is checked.";
  const skimp = state.strategy === "skimp";
  $("#skipCtl").classList.toggle("off", !skimp);
  $("#skip").disabled = !skimp;
  $("#skipOut").textContent = pct(state.skip);
  $("#stratBlurb").textContent = BLURBS[state.strategy];
  $("#shots").disabled = !!state.sent;
  const oneJob = state.sent && /ionq/i.test(state.sent.backend);
  $("#reseed").disabled = oneJob;
  $("#reseed").title = oneJob ? "IonQ allows one job per run. Press Run again for a new batch." : "Build a new random batch";
  $("#send").innerHTML = state.sent ? `See the results ${icon("i-arrow")}` : `${icon("i-send")}Hide the traps and send`;
  if (state.odds) {
    drawCatch();
    catchNote();
  }
  if (state.sent) updateJobText();
}

function renderOps(ops) {
  const rows = [];
  for (let i = 0; i < ops.length; i += 8) rows.push(ops.slice(i, i + 8));
  $("#ops").innerHTML = rows
    .map(
      (row, r) =>
        `<div class="op-row"><span class="n">${r + 1}</span>${row
          .map(([g, q, a]) => `<span class="op ${g.toLowerCase()}"><b>${g}</b>${a ? `(${a})` : ""} q${q}</span>`)
          .join("")}</div>`,
    )
    .join("");
}

async function newBatch() {
  state.sent = null;
  state.revealed = false;
  state.smartKind = null;
  $("#servers").innerHTML = `<div class="empty card">Send your job to see what comes back.</div>`;
  $("#smart").innerHTML = `<div class="empty card">Pick a kind of real job: <b>sampling jobs</b> have spread-out output, <b>answer jobs</b> have one clear answer, like traps.</div>`;
  $$("#kindSeg button").forEach((b) => b.classList.remove("on"));
  $("#reveal").disabled = true;
  setBackend(null);
  const built = await state.api.build(state.seed);
  renderOps(built.ops);
  await showLayout();
  status("");
  updateControls();
  return built;
}

function status(html) {
  $("#status").innerHTML = html;
}

function setBackend(sent) {
  $("#backendChip").classList.toggle("on", !!sent);
  $("#backendChip span").textContent = sent ? `${sent.backend} · ${sent.shots} shots` : "Not sent yet";
  $("#sideBackend").textContent = sent ? sent.backend : "Picked when you send";
  $("#sideBackendSub").textContent = sent ? `Ran ${sent.ran_at} · ${sent.seconds}s` : "The machine chosen in Qollab's Select QPU.";
}

/** The one backend job: every circuit any cloud needs, for every view. */
async function ensureSent() {
  if (state.sent) return;
  status(`Running ${2 * (N_REAL + 40) + N_REAL + 20} circuits × ${state.shots} shots as one job…`);
  state.sent = await state.api.send(state.shots);
  status(`${icon("tick")}Ran on ${state.sent.backend} · ${state.sent.shots} shots · ${state.sent.seconds}s`);
  setBackend(state.sent);
  updateControls();
}

async function send() {
  const btn = $("#send");
  btn.disabled = true;
  try {
    if (!state.sent) {
      $$("#batch .cell.trap").forEach((c) => c.classList.add("hidden-trap"));
      await ensureSent();
      await wait(1100);
    }
    showView("results");
    await renderResults(true);
  } catch (err) {
    status(`Something went wrong: ${err.message || err}`);
    throw err;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Results ---------- */

function cellFor(c) {
  const share = c.top.length ? c.top[0][1] : 0;
  if (c.kind === "trap") {
    const tip = `${c.ok ? "Trap alive" : "Trap DEAD"} · expected ${c.expected} · got ${c.answer} (${pct(share)} of shots)`;
    return `<div class="cell pending" data-final="${c.ok ? "alive" : "dead"}" data-icon="${c.ok ? "bird" : "x"}" data-tip="${tip}"></div>`;
  }
  const truth = c.kind === "flat" ? (c.ok ? "close to the exact output" : "far from the exact output") : c.ok ? `right (exact answer ${c.expected})` : `WRONG (exact answer ${c.expected})`;
  return `<div class="cell pending" data-final="real" data-truth="${c.ok ? "right" : "wrong"}" data-icon="q" data-tip="Real task · top answer ${c.answer} (${pct(share)}) · can't be checked" data-truth-tip="Real task · top answer ${c.answer} · ${truth}"></div>`;
}

function cloudCard(r, letter) {
  const rc = r.receipt;
  const alive = rc.traps - rc.failed;
  const sub = !rc.traps ? "No traps, so nothing was checked." : rc.caught ? `${rc.failed} of ${rc.traps} traps dead.` : `All ${rc.traps} traps alive.`;
  const promise = rc.caught ? `Up to <b>${pct(rc.max_wrong)}</b> of your answers may be wrong.` : `At least <b>${pct(rc.min_right)}</b> of your answers are right.`;
  const blurb = r.server === "honest" && state.sent ? `Runs every circuit on ${state.sent.backend}, every shot.` : r.blurb;
  return `<article class="card cloud" data-server="${r.server}">
    <div class="cloud-head"><span class="tile tile-sm ${rc.caught ? "tile-bad" : "tile-good"}">${icon("i-cloud")}</span><p class="label">Cloud ${letter} · <b>${NAMES[r.server]}</b></p><span class="cost">${pct(r.cost)} of price</span></div>
    <div class="verdict ${rc.caught ? "caught" : "pass"}"><span class="tile ${rc.caught ? "tile-bad" : "tile-good"}">${icon(rc.caught ? "x" : "tick")}</span><div><b>${rc.caught ? "CAUGHT" : "PASSED"}</b><span>${sub}</span></div></div>
    <div class="cloud-body">
      <p class="muted">${blurb}</p>
      <div class="counts"><span><i class="dot dot-good"></i>Alive traps <b>${alive}</b></span><span><i class="dot dot-bad"></i>Dead traps <b>${rc.failed}</b></span><span><i class="dot"></i>Real tasks <b>${r.truth.real_jobs}</b></span></div>
      <div class="cells">${r.circuits.map(cellFor).join("")}</div>
      <div class="legend key" hidden><span><span class="cell alive cell-xs">${icon("bird")}</span>trap alive</span><span><span class="cell dead cell-xs">${icon("x")}</span>trap dead</span><span><span class="cell right cell-xs">${icon("tick")}</span>answer right</span><span><span class="cell wrong cell-xs">${icon("x")}</span>answer wrong</span></div>
      <div class="receipt" style="margin-top:18px">
        <div class="receipt-head"><span class="tile tile-sm">${icon("i-receipt")}</span><p class="label">Receipt · Cloud ${letter}</p><span class="tag ${rc.caught ? "bad" : ""}">${rc.caught ? "Caught" : "Passed"}</span></div>
        <p class="receipt-promise">${promise} <span class="muted">(${pct(rc.confidence)} confidence)</span></p>
        <div class="receipt-kv"><div><span>Receipt ID</span><b>${r.receipt_id}</b></div><div><span>Traps alive</span><b>${alive} / ${rc.traps}</b></div><div><span>Ran at</span><b>${r.ran_at || "-"}</b></div></div>
      </div>
    </div>
  </article>`;
}

function truthCard(servers, letters) {
  const body = state.revealed
    ? servers
        .map((r, i) => {
          const t = r.truth;
          return `<div class="truth-row"><b>Cloud ${letters[i]} · ${NAMES[r.server]}</b><p>Actually wrong: <b class="mono">${t.wrong} of ${t.real_jobs}</b> (${pct(t.wrong_share)}). The receipt promised at most ${pct(r.receipt.max_wrong)}.</p>
            <span class="held ${t.receipt_held ? "ok" : "no"}">${icon(t.receipt_held ? "tick" : "x")}${t.receipt_held ? "Receipt held" : "Receipt was wrong"}</span></div>`;
        })
        .join("")
    : `<p class="truth-locked">Only a simulation can do this: compare every real answer with the exact one, to see whether each receipt told the truth. Press <b>Reveal the truth</b>.</p>`;
  return `<aside class="card truth"><div class="card-head"><h3><span class="tile">${icon("i-eye")}</span>Truth</h3><span class="muted">${state.revealed ? "revealed" : "hidden"}</span></div><div class="truth-body">${body}</div></aside>`;
}

async function animate(container, step = 22) {
  const cells = [...container.querySelectorAll(".cell.pending")];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    c.classList.remove("pending");
    c.classList.add(c.dataset.final === "real" ? "real" : c.dataset.final);
    c.innerHTML = icon(c.dataset.icon);
    if (step && i % 3 === 2) await wait(step);
  }
}

function revealCells(container) {
  container.querySelectorAll('.cell[data-final="real"]').forEach((c) => {
    c.classList.add(c.dataset.truth);
    c.innerHTML = icon(c.dataset.truth === "right" ? "tick" : "x");
    c.dataset.tip = c.dataset.truthTip;
  });
  container.querySelectorAll(".key").forEach((k) => (k.hidden = false));
}

let lastServers = null;
async function renderResults(animated) {
  const { servers } = await state.api.report(state.strategy, state.traps, state.skip);
  lastServers = servers;
  const box = $("#servers");
  box.innerHTML = cloudCard(servers[0], "A") + cloudCard(servers[1], "B") + truthCard(servers, ["A", "B"]);
  await animate(box, animated ? 22 : 0);
  if (state.revealed) revealCells(box);
  $("#reveal").disabled = false;
}

function reveal() {
  state.revealed = true;
  const box = $("#servers");
  revealCells(box);
  box.querySelector(".truth").outerHTML = truthCard(lastServers, ["A", "B"]);
}

/* ---------- Smart cheater ---------- */

async function runSmart(kind) {
  state.smartKind = kind;
  $$("#kindSeg button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  const box = $("#smart");
  box.innerHTML = `<div class="empty card">Running…</div>`;
  await ensureSent();
  const r = (await state.api.smart(kind)).servers[0];
  $("#smartLede").textContent = `This cloud peeks at each circuit with ${PROBE_SHOTS} shots (${pct(r.cost)} of the work at ${state.sent.shots} shots). If one answer dominates, it guesses "trap" and sends back a polished result. Everything else it fakes.`;
  box.innerHTML = cloudCard(r, "C") + smartTruth(r, false);
  await animate(box);
  box.querySelector("#smartReveal").addEventListener("click", () => {
    revealCells(box);
    box.querySelector(".truth").outerHTML = smartTruth(r, true);
  });
}

function smartTruth(r, revealed) {
  if (!revealed)
    return `<aside class="card truth"><div class="card-head"><h3><span class="tile">${icon("i-eye")}</span>Truth</h3><span class="muted">hidden</span></div>
      <div class="truth-body"><p class="truth-locked">The receipt says ${r.receipt.caught ? "it was caught" : "it passed"}. Was the receipt right? Only a simulation can check the real answers.</p>
      <button class="btn btn-lg" id="smartReveal">${icon("i-eye")}Reveal the truth</button></div></aside>`;
  const t = r.truth;
  const fooled = !r.receipt.caught && t.wrong_share > r.receipt.max_wrong;
  const lesson = fooled
    ? `All traps survived, yet ${t.wrong} of ${t.real_jobs} real results are junk. The traps had one sharp answer and these jobs didn't, so a quick peek told the cheater which was which. A trap is only as good as its disguise, and that includes what its output looks like.`
    : !r.receipt.caught && t.wrong === 0
      ? `Here the real jobs look just like traps, so the only way past the traps was to get every answer right. Traps don't catch cheating. They catch wrong answers, which is the only kind of cheating that costs you anything.`
      : `${r.receipt.failed} of ${r.receipt.traps} traps dead; ${t.wrong} of ${t.real_jobs} real answers actually wrong.`;
  return `<aside class="card truth"><div class="card-head"><h3><span class="tile">${icon("i-eye")}</span>Truth</h3><span class="muted">revealed</span></div>
    <div class="truth-body">
      <div class="fooled ${fooled ? "bad" : "ok"}"><span class="tile ${fooled ? "tile-bad" : "tile-good"}">${icon(fooled ? "x" : "tick")}</span><b>${fooled ? "FOOLED." : "NOT FOOLED."}</b></div>
      <dl class="kv-rows"><div><dt><i class="dot dot-good"></i>Traps alive</dt><dd>${r.receipt.traps - r.receipt.failed} / ${r.receipt.traps}</dd></div>
        <div><dt><i class="dot dot-bad"></i>Real answers wrong</dt><dd>${t.wrong} / ${t.real_jobs}</dd></div>
        <div><dt>Receipt promised at most</dt><dd>${pct(r.receipt.max_wrong)} wrong</dd></div></dl>
      <div class="truth-row"><p>${lesson}</p></div>
    </div></aside>`;
}

/* ---------- Charts ---------- */

function lineChart(el, { series, xDomain, xTicks, xLabel, xFmt = (x) => x, marker }) {
  const W = 520, H = 290, L = 44, R = 14, T = 10, B = 42;
  const sx = (x) => L + ((x - xDomain[0]) / (xDomain[1] - xDomain[0])) * (W - L - R);
  const sy = (y) => T + (1 - y) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid">`;
  for (const y of [0, 0.25, 0.5, 0.75, 1]) svg += `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}"/><text x="${L - 8}" y="${sy(y) + 4}" text-anchor="end">${pct(y)}</text>`;
  svg += `</g><g class="axis"><line x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  for (const x of xTicks) svg += `<text x="${sx(x)}" y="${H - B + 18}" text-anchor="middle">${xFmt(x)}</text>`;
  svg += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${xLabel}</text></g>`;
  if (marker != null) svg += `<line x1="${sx(marker)}" x2="${sx(marker)}" y1="${T}" y2="${sy(0)}" stroke="var(--brand)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  for (const s of series) {
    if (s.line) svg += `<path d="${s.points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ""}/>`;
    if (s.dots) svg += s.points.map(([x, y]) => `<circle cx="${sx(x)}" cy="${sy(y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join("");
  }
  svg += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${sy(0)}" stroke="var(--text-muted)" visibility="hidden"/>`;
  svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${sy(0) - T}" fill="transparent"/></svg>`;
  const legend = `<div class="chart-legend">${series.map((s) => `<span><i class="${s.line ? "" : "dot"}" style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>`;
  el.innerHTML = legend + svg;

  const svgEl = el.querySelector("svg");
  const xh = svgEl.querySelector(".xh");
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  svgEl.querySelector("rect").addEventListener("mousemove", (e) => {
    const box = svgEl.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    const x = xs.reduce((best, v) => (Math.abs(sx(v) - vx) < Math.abs(sx(best) - vx) ? v : best), xs[0]);
    xh.setAttribute("x1", sx(x));
    xh.setAttribute("x2", sx(x));
    xh.setAttribute("visibility", "visible");
    const rows = series
      .map((s) => [s, s.points.find((p) => p[0] === x)])
      .filter(([, p]) => p)
      .map(([s, p]) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pct(p[1])}</b></div>`)
      .join("");
    showTip(`<div><b>${xLabel.split(" (")[0]}: ${xFmt(x)}</b></div>${rows}`, e);
  });
  svgEl.querySelector("rect").addEventListener("mouseleave", () => {
    xh.setAttribute("visibility", "hidden");
    hideTip();
  });
}

function table(el, head, rows) {
  el.innerHTML = `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</table>`;
}

/* Same bound as engine/checker.py with no dead traps: the largest number
   of wrong circuits W for which "no trap among them" still has > 5% odds. */
function cleanBound(t, n) {
  let w = 0;
  for (;;) {
    let p = 1;
    for (let i = 0; i < t; i++) p *= (t + n - (w + 1) - i) / (t + n - i);
    if (p <= 0.05 || w + 1 > n) break;
    w += 1;
  }
  return w / n;
}


function drawCatch() {
  const c = state.odds.catch_curve;
  const ts = Array.from({ length: 41 }, (_, i) => i);
  lineChart($("#chartCatch"), {
    xDomain: [0, 40],
    xTicks: [0, 10, 20, 30, 40],
    xLabel: "Traps hidden",
    marker: state.traps,
    series: [
      { name: "Chance of catching it", color: "var(--series-1)", points: ts.map((t) => [t, theoryCatch(c.q, t)]), line: true },
      { name: "Measured catch rate", color: "var(--series-1)", points: c.traps.map((t, i) => [t, c.measured[i]]), dots: true },
      { name: "Worst case if all traps live", color: "var(--series-2)", points: ts.slice(1).map((t) => [t, cleanBound(t, c.n_real)]), line: true },
      { name: "Bill spent on traps", color: "var(--series-3)", points: ts.map((t) => [t, t / (c.n_real + t)]), line: true, dash: true },
    ],
  });
  $("#curveQ").textContent = pct(c.q);
  table(
    $("#tblCatch"),
    ["Traps", "Catch (theory)", "Catch (measured)", "Worst case wrong", "Bill on traps"],
    c.traps.map((t, i) => [t, pct(c.theory[i]), pct(c.measured[i]), pct(c.clean_bound[i]), pct(c.compute_share[i])]),
  );
}

const theoryCatch = (q, t) => 1 - (1 - q * (1 - 1 / 32)) ** t;

function catchNote() {
  const c = state.odds.catch_curve, t = state.traps;
  $("#catchNote").innerHTML = t
    ? `${icon("i-info")}<span>At <b>${t} traps</b>: a ${pct(theoryCatch(c.q, t))} chance of catching a cloud that fakes ${pct(c.q)} of circuits. If every trap lives, at most <b>${pct(cleanBound(t, c.n_real))}</b> of your answers can be wrong. <b>${pct(t / (c.n_real + t))}</b> of your bill goes on traps.</span>`
    : `${icon("i-info")}<span>With no traps, nothing is checked and the receipt can promise nothing.</span>`;
}

function sweepSpec(pts) {
  return {
    xDomain: [0, pts[pts.length - 1].level],
    xTicks: pts.filter((_, i) => i % 2 === 0).map((p) => p.level),
    xLabel: "Gate over-rotation (radians)",
    xFmt: (x) => x.toFixed(2),
    series: [
      { name: "Real answers actually wrong", color: "var(--series-1)", points: pts.map((p) => [p.level, p.wrong]), line: true, dots: true },
      { name: "Traps dead", color: "var(--series-2)", points: pts.map((p) => [p.level, p.dead]), line: true, dots: true },
    ],
  };
}

function drawSweep() {
  const s = state.odds.quality_sweep;
  lineChart($("#chartSweep"), sweepSpec(s.points));
  $("#sweepN").textContent = `${s.n_real} real tasks and ${s.n_traps} traps`;
  table($("#tblSweep"), ["Over-rotation", "Answers wrong", "Traps dead"], s.points.map((p) => [p.level.toFixed(2), pct(p.wrong), pct(p.dead)]));
}

function drawCoverage() {
  const c = state.odds.coverage;
  $("#covSub").textContent = `${c.runs} runs per cloud · 20 traps · ${pct(c.confidence)} receipt`;
  $("#coverage").innerHTML = Object.entries(c.held)
    .map(([k, v]) => `<div class="stat"><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${pct1(v)}</b><em>of runs, the receipt held</em></div>`)
    .join("");
}

/* ---------- Tooltip ---------- */

const tip = $("#tip");
function showTip(html, e) {
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY + 14}px`;
}
function hideTip() {
  tip.hidden = true;
}
document.addEventListener("mousemove", (e) => {
  const cell = e.target.closest && e.target.closest("[data-tip]");
  if (cell) showTip(`<div class="mono">${cell.dataset.tip}</div>`, e);
  else if (!e.target.closest || !e.target.closest(".chart svg")) hideTip();
});



/* ---------- Wire up ---------- */

let debounce;
function changed(layoutChanged) {
  updateControls();
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    if (layoutChanged) await showLayout();
    if (state.sent && $("#servers .cloud")) await renderResults(false);
  }, 150);
}

export async function start(api, odds) {
  state.api = api;
  state.odds = odds;
  startDots($("#dots"));
  $("#strategy").innerHTML = Object.keys(BLURBS).map((s) => `<option value="${s}" ${s === state.strategy ? "selected" : ""}>${NAMES[s]}</option>`).join("");
  const setTraps = (e) => ((state.traps = +e.target.value), changed(true));
  $("#traps").addEventListener("input", setTraps);
  $("#traps2").addEventListener("input", setTraps);
  $("#strategy").addEventListener("change", (e) => ((state.strategy = e.target.value), changed(false)));
  $("#skip").addEventListener("input", (e) => ((state.skip = +e.target.value / 100), changed(false)));
  $("#shots").addEventListener("change", (e) => ((state.shots = +e.target.value), updateControls()));
  $("#reseed").addEventListener("click", () => ((state.seed += 1), newBatch()));
  $("#send").addEventListener("click", send);
  $("#reveal").addEventListener("click", reveal);
  $$("#kindSeg button").forEach((b) => b.addEventListener("click", () => runSmart(b.dataset.kind)));
  $$(".open-console").forEach((b) => b.addEventListener("click", () => showConsole(true)));
  $("#backToStart").addEventListener("click", () => showConsole(false));
  $$(".side button").forEach((b) =>
    b.addEventListener("click", () => {
      showView(b.dataset.view);
      if (b.dataset.view === "results" && state.sent && !$("#servers .cloud")) renderResults(true);
    }),
  );
  drawCatch();
  catchNote();
  drawSweep();
  drawCoverage();
  fillLanding(null);
  status("Building the batch…");
  try {
    fillLanding(await newBatch());
  } catch (err) {
    status(`Couldn't build the batch: ${err.message || err}`);
  }
}
