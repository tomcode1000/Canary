"use strict";

const $ = (s) => document.querySelector(s);
const pct = (x) => `${Math.round(x * 100)}%`;
const N_REAL = 30;
const NAMES = { honest: "Honest", lazy: "Lazy", cheap: "Cheap machine", skimp: "Skimps", smart: "Smart cheater" };
const icon = (id) => `<svg class="i"><use href="#${id}"/></svg>`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { traps: 20, strategy: "cheap", skip: 0.3, seed: 1, run: null, odds: null };

async function api(path, params = {}) {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function runParams(extra = {}) {
  return { strategy: state.strategy, n_real: N_REAL, n_traps: state.traps, skip: state.skip, seed: state.seed, ...extra };
}

/* ---------- Act 1: the batch ---------- */

function renderBatch(run) {
  const cells = run.servers[0].circuits
    .map((c) => (c.kind === "trap" ? `<div class="cell trap" data-tip="Trap · you know its answer: ${c.expected}">${icon("bird")}</div>` : `<div class="cell" data-tip="Real job"></div>`))
    .join("");
  $("#batch").innerHTML = cells;
  $("#batchCaption").textContent = "Your view: you know which circuits are traps.";
  $("#preview").textContent = run.circuit_preview;
}

function updateControls() {
  $("#trapsOut").textContent = state.traps;
  const share = state.traps / (N_REAL + state.traps);
  $("#trapsCost").textContent = state.traps ? `${pct(share)} of what you pay goes on checks.` : "No traps: nothing is checked.";
  $("#skipCtl").hidden = state.strategy !== "skimp";
  $("#skipOut").textContent = pct(state.skip);
  const s = (state.strategies || []).find((x) => x.name === state.strategy);
  $("#stratBlurb").textContent = s ? s.blurb : "";
  if (state.odds) drawCatch();
}

let loadToken = 0;
async function loadBatch() {
  const token = ++loadToken;
  $("#send").disabled = true;
  let run;
  try {
    run = await api("/api/run", runParams());
  } catch (err) {
    $("#batch").innerHTML = `<p class="empty">Couldn't build the batch (${err.message}). Is the server running?</p>`;
    return;
  }
  if (token !== loadToken) return;
  state.run = run;
  renderBatch(run);
  $("#send").disabled = false;
}

/* ---------- Act 2: servers ---------- */

function cellFor(c) {
  const share = c.top.length ? c.top[0][1] : 0;
  if (c.kind === "trap") {
    const tip = c.ok
      ? `Trap alive · expected ${c.expected} · got ${c.answer} (${pct(share)} of shots)`
      : `Trap DEAD · expected ${c.expected} · got ${c.answer} (${pct(share)} of shots)`;
    return `<div class="cell pending" data-final="${c.ok ? "alive" : "dead"}" data-icon="${c.ok ? "bird" : "dead"}" data-tip="${tip}"></div>`;
  }
  const truth = c.kind === "flat" ? (c.ok ? "close to the exact output" : "far from the exact output") : c.ok ? `right (exact answer ${c.expected})` : `WRONG (exact answer ${c.expected})`;
  return `<div class="cell pending" data-final="real" data-truth="${c.ok ? "right" : "wrong"}" data-icon="q" data-tip="Real job · top answer ${c.answer} (${pct(share)}) · you can't check this" data-truth-tip="Real job · top answer ${c.answer} · ${truth}"></div>`;
}

function serverCard(r, label) {
  const rc = r.receipt;
  const t = r.truth;
  const promise = rc.caught ? `Up to <b>${pct(rc.max_wrong)}</b> of your answers may be wrong.` : `At least <b>${pct(rc.min_right)}</b> of your answers are right.`;
  return `<article class="panel server" data-server="${r.server}">
    <h3>${label} · ${NAMES[r.server]}<small>spent ${pct(r.cost)} of the price</small></h3>
    <p class="blurb">${r.blurb}</p>
    <div class="cells">${r.circuits.map(cellFor).join("")}</div>
    <div class="receipt" hidden>
      <span class="verdict ${rc.caught ? "caught" : "pass"}">${icon(rc.caught ? "dead" : "tick")} ${rc.caught ? "CAUGHT" : "PASSED"}</span>
      <p class="big">${promise} <span class="muted">(${pct(rc.confidence)} confidence)</span></p>
      <p>${rc.traps - rc.failed} of ${rc.traps} traps alive${rc.failed ? `, ${rc.failed} dead` : ""}.</p>
      <div class="truth">Receipt promised at most <b>${pct(rc.max_wrong)}</b> wrong. Actually wrong: <b>${t.wrong} of ${t.real_jobs}</b> (${pct(t.wrong_share)}).
        <span class="${t.receipt_held ? "ok" : "bad"}">${t.receipt_held ? "The receipt held." : "The receipt was wrong."}</span></div>
    </div>
  </article>`;
}

async function animate(container) {
  const cells = [...container.querySelectorAll(".cell.pending")];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    c.classList.remove("pending");
    if (c.dataset.final !== "real") c.classList.add(c.dataset.final);
    c.innerHTML = icon(c.dataset.icon);
    if (i % 3 === 2) await wait(28);
  }
  container.querySelectorAll(".receipt").forEach((r) => (r.hidden = false));
}

const KEY = `<div class="key">
  <span><span class="cell alive">${icon("bird")}</span>trap alive</span>
  <span><span class="cell dead">${icon("dead")}</span>trap dead</span>
  <span><span class="cell right">${icon("tick")}</span>real answer right</span>
  <span><span class="cell wrong">${icon("dead")}</span>real answer wrong</span></div>`;

function reveal(container) {
  container.querySelectorAll(".server").forEach((s) => {
    if (!s.classList.contains("revealed")) s.querySelector(".cells").insertAdjacentHTML("afterend", KEY);
    s.classList.add("revealed");
  });
  container.querySelectorAll('.cell[data-final="real"]').forEach((c) => {
    c.classList.add(c.dataset.truth);
    c.innerHTML = icon(c.dataset.truth === "right" ? "tick" : "dead");
    c.dataset.tip = c.dataset.truthTip;
  });
}

async function send() {
  if (!state.run) return;
  $("#send").disabled = true;
  document.querySelectorAll("#batch .cell.trap").forEach((c) => c.classList.add("hidden-trap"));
  $("#batchCaption").textContent = `What the clouds see: ${N_REAL + state.traps} circuits with the same shape. Nothing marks the traps.`;
  await wait(900);
  const [a, b] = state.run.servers;
  const box = $("#servers");
  box.innerHTML = serverCard(a, "Cloud A") + serverCard(b, "Cloud B");
  $("#revealRow").hidden = true;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  await animate(box);
  $("#revealRow").hidden = false;
  $("#send").disabled = false;
}

/* ---------- Act 4: smart cheater ---------- */

async function runSmart(kind) {
  document.querySelectorAll("#kindSeg button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  const box = $("#smart");
  box.innerHTML = `<p class="empty">Running…</p>`;
  $("#lesson").hidden = true;
  const run = await api("/api/run", { strategy: "smart", real_kind: kind, n_real: N_REAL, n_traps: 20, seed: state.seed });
  const r = run.servers[1];
  box.innerHTML = serverCard(r, "Cloud C");
  await animate(box);
  await wait(500);
  reveal(box);
  const fooled = !r.receipt.caught && r.truth.wrong_share > r.receipt.max_wrong;
  const lesson = fooled
    ? `<b>Fooled.</b> All traps survived, yet ${r.truth.wrong} of ${r.truth.real_jobs} real results are junk. The traps had one sharp answer and these jobs didn't, so a quick peek told the cheater which was which. A trap is only as good as its disguise, and that includes what its output looks like.`
    : !r.receipt.caught && r.truth.wrong === 0
      ? `<b>Not fooled.</b> Here the real jobs look just like traps, so the only way past the traps was to get every answer right. Traps don't catch cheating. They catch wrong answers, which is the only kind of cheating that costs you anything.`
      : `<b>${r.receipt.caught ? "Caught." : "Passed."}</b> ${r.receipt.failed} of ${r.receipt.traps} traps dead; ${r.truth.wrong} of ${r.truth.real_jobs} real answers actually wrong.`;
  $("#lesson").innerHTML = lesson;
  $("#lesson").hidden = false;
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
    if (s.dots) svg += s.points.map(([x, y]) => `<circle cx="${sx(x)}" cy="${sy(y)}" r="4.5" fill="${s.color}" stroke="var(--surface-1)" stroke-width="2"/>`).join("");
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
  const theory = ts.map((t) => [t, 1 - (1 - c.q * (1 - 1 / 32)) ** t]);
  const bound = ts.slice(1).map((t) => [t, cleanBound(t, c.n_real)]);
  const bill = ts.map((t) => [t, t / (c.n_real + t)]);
  lineChart($("#chartCatch"), {
    xDomain: [0, 40],
    xTicks: [0, 10, 20, 30, 40],
    xLabel: "Traps hidden",
    marker: state.traps,
    series: [
      { name: "Chance of catching it", color: "var(--series-1)", points: theory, line: true },
      { name: "Measured catch rate", color: "var(--series-1)", points: c.traps.map((t, i) => [t, c.measured[i]]), dots: true },
      { name: "Worst case if all traps live", color: "var(--series-2)", points: bound, line: true },
      { name: "Bill spent on traps", color: "var(--series-3)", points: bill, line: true, dash: true },
    ],
  });
  $("#curveQ").textContent = pct(c.q);
  table(
    $("#tblCatch"),
    ["Traps", "Catch (theory)", "Catch (measured)", "Worst case wrong", "Bill on traps"],
    c.traps.map((t, i) => [t, pct(c.theory[i]), pct(c.measured[i]), pct(c.clean_bound[i]), pct(c.compute_share[i])]),
  );
}

function drawSweep() {
  const s = state.odds.quality_sweep;
  const pts = s.points;
  lineChart($("#chartSweep"), {
    xDomain: [0, pts[pts.length - 1].level],
    xTicks: pts.filter((_, i) => i % 2 === 0).map((p) => p.level),
    xLabel: "Gate over-rotation (radians)",
    xFmt: (x) => x.toFixed(2),
    series: [
      { name: "Real answers actually wrong", color: "var(--series-1)", points: pts.map((p) => [p.level, p.wrong]), line: true, dots: true },
      { name: "Traps dead", color: "var(--series-2)", points: pts.map((p) => [p.level, p.dead]), line: true, dots: true },
    ],
  });
  $("#sweepN").textContent = `${s.n_real} real jobs and ${s.n_traps} traps`;
  table($("#tblSweep"), ["Over-rotation", "Answers wrong", "Traps dead"], pts.map((p) => [p.level.toFixed(2), pct(p.wrong), pct(p.dead)]));
}

function drawCoverage() {
  const c = state.odds.coverage;
  $("#coverage").innerHTML = `<h4>Does the receipt tell the truth?</h4>
    <p>${c.runs} runs per cloud, 20 traps each. A ${pct(c.confidence)} receipt should hold in about ${pct(c.confidence)} of runs or more.</p>
    <div class="cov">${Object.entries(c.held).map(([k, v]) => `<div><b>${pct(v)}</b><span>held · ${k}</span></div>`).join("")}</div>`;
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
function changed() {
  updateControls();
  clearTimeout(debounce);
  debounce = setTimeout(loadBatch, 250);
}

async function main() {
  state.strategies = (await api("/api/strategies")).filter((s) => s.name !== "smart");
  $("#strategy").innerHTML = state.strategies.map((s) => `<option value="${s.name}" ${s.name === state.strategy ? "selected" : ""}>${NAMES[s.name]}</option>`).join("");
  $("#traps").addEventListener("input", (e) => ((state.traps = +e.target.value), changed()));
  $("#strategy").addEventListener("change", (e) => ((state.strategy = e.target.value), changed()));
  $("#skip").addEventListener("input", (e) => ((state.skip = +e.target.value / 100), changed()));
  $("#reseed").addEventListener("click", () => ((state.seed += 1), changed()));
  $("#send").addEventListener("click", send);
  $("#reveal").addEventListener("click", () => reveal($("#servers")));
  document.querySelectorAll("#kindSeg button").forEach((b) => b.addEventListener("click", () => runSmart(b.dataset.kind)));
  updateControls();
  loadBatch();
  try {
    state.odds = await api("/api/odds");
    drawCatch();
    drawSweep();
    drawCoverage();
  } catch {
    $("#act3 .charts").innerHTML = `<p class="empty">Charts need <code>python -m engine.odds</code> to run once.</p>`;
  }
}

main();
