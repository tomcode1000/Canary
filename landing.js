// The landing background: a quantum circuit drifting left. Gates are the
// ones Canary really uses (RZ, SX, CX). Every few seconds one gate shows
// itself as a trap (the canary), then blends back in: traps hide in plain
// sight. Static when the viewer prefers reduced motion.

const BIRD = new Path2D(
  "M15.5 5.5a3.5 3.5 0 0 1 3.4 2.7l2.6.8-2.5 1.4c-.2 4.8-4 8.6-8.8 8.6H5l2.4-2.6C5 15.3 3.5 13 3.5 10.5c2.6 1.6 5.6 2 8.6 1.2.1-3.4 1.2-6.2 3.4-6.2Z",
);
const WIRES = 5;
const SPEED = 26; // px per second
const SPACING = 74; // px between gate columns
const BOX = 24;

export function startCircuit(canvas) {
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--text-secondary").trim() || "#c3c2b7";
  const brand = css.getPropertyValue("--brand").trim() || "#f4c430";
  const bg = css.getPropertyValue("--bg").trim() || "#121211";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, columns = [], offset = 0, last = 0, glow = null, nextGlow = 0.6;

  const wireY = (i) => h * 0.26 + (i * h * 0.48) / (WIRES - 1);

  function column() {
    // Each column holds either one CX, or single-qubit gates on some wires.
    if (Math.random() < 0.35) {
      const c = Math.floor(Math.random() * (WIRES - 1));
      return [{ kind: "cx", wire: c, target: c + 1 }];
    }
    return Array.from({ length: WIRES }, (_, wire) => wire)
      .filter(() => Math.random() < 0.45)
      .map((wire) => ({ kind: Math.random() < 0.5 ? "rz" : "sx", wire }));
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const need = Math.ceil(w / SPACING) + 2;
    while (columns.length < need) columns.push(column());
  }

  function gate(g, x, alpha, trap) {
    const y = wireY(g.wire);
    ctx.globalAlpha = alpha;
    if (g.kind === "cx") {
      const ty = wireY(g.target);
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, ty + 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, ty, 9, 0, Math.PI * 2);
      ctx.moveTo(x - 9, ty);
      ctx.lineTo(x + 9, ty);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = bg;
    ctx.fillRect(x - BOX / 2, y - BOX / 2, BOX, BOX);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = trap ? brand : ink;
    ctx.strokeRect(x - BOX / 2, y - BOX / 2, BOX, BOX);
    if (trap) {
      ctx.save();
      ctx.translate(x - 9, y - 9);
      ctx.scale(0.75, 0.75);
      ctx.fillStyle = brand;
      ctx.fill(BIRD);
      ctx.restore();
    } else {
      ctx.fillStyle = ink;
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(g.kind === "rz" ? "RZ" : "SX", x, y + 0.5);
    }
  }

  function draw(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 0;
    last = t;
    if (!still) offset += SPEED * dt;
    while (offset >= SPACING) {
      offset -= SPACING;
      columns.shift();
      columns.push(column());
      if (glow) glow.col -= 1;
    }
    nextGlow -= dt;
    if (!glow && nextGlow <= 0) {
      // Pick a single-qubit gate in the middle of the screen to reveal.
      // Right half of the screen, where the text doesn't cover the circuit.
      const mid = Math.floor(columns.length * (0.62 + Math.random() * 0.25));
      const g = (columns[mid] || []).find((x) => x.kind !== "cx");
      if (g) glow = { col: mid, g, age: 0 };
      nextGlow = 1.6;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    for (let i = 0; i < WIRES; i++) {
      ctx.beginPath();
      ctx.moveTo(0, wireY(i));
      ctx.lineTo(w, wireY(i));
      ctx.stroke();
    }
    // Column 0 is leftmost; columns leave on the left and arrive on the right.
    columns.forEach((col, c) => {
      const x = c * SPACING - offset + SPACING / 2;
      for (const g of col) {
        gate(g, x, 0.55, false);
        if (glow && glow.g === g) {
          // Fade in, hold, fade back to an ordinary gate.
          const a = glow.age < 0.4 ? glow.age / 0.4 : glow.age < 1.6 ? 1 : Math.max(0, 1 - (glow.age - 1.6) / 0.6);
          gate(g, x, a, true);
        }
      }
    });
    if (glow) {
      glow.age += dt || 0.016;
      if (glow.age > 2.2) glow = null;
    }
    ctx.globalAlpha = 1;
    if (!still) requestAnimationFrame(draw);
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(draw);
}
