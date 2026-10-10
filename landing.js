// The landing background: measurement shots becoming an answer.
// Scattered dots drift like noise, pull together into the canary, hold,
// then scatter again. Each dot stands for one shot; a share never joins
// (the noise every real machine has). Still when reduced motion is on.

// A perched canary in a 100 x 100 box, built from simple shapes. Each is
// tested on its own (a combined path could cancel out where shapes overlap).
function shape(build) {
  const p = new Path2D();
  build(p);
  return p;
}
const BIRD_PARTS = [
  shape((p) => p.ellipse(50, 57, 31, 17, (-32 * Math.PI) / 180, 0, Math.PI * 2)), // body
  shape((p) => p.ellipse(66, 41, 12, 13, 0, 0, Math.PI * 2)), // neck
  shape((p) => p.arc(74, 30, 13, 0, Math.PI * 2)), // head
  shape((p) => { p.moveTo(84, 25); p.lineTo(97, 30.5); p.lineTo(84, 35); p.closePath(); }), // beak
  shape((p) => { p.moveTo(28, 68); p.lineTo(5, 93); p.lineTo(13, 96); p.lineTo(38, 76); p.closePath(); }), // tail
  shape((p) => { p.rect(53.5, 70, 2.2, 13); p.rect(61.5, 67, 2.2, 16); }), // legs
  shape((p) => p.rect(38, 82.5, 42, 2)), // perch
];
const EYE = { x: 77.5, y: 27.5, r: 2.8 };
const NOISE_SHARE = 0.18;
// Seconds per phase: drift, gather, hold, release.
const PHASES = [2.6, 2.0, 2.4, 1.4];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function startDots(canvas) {
  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const ink = hexToRgb(css.getPropertyValue("--text-muted").trim() || "#8d8c84");
  const brand = hexToRgb(css.getPropertyValue("--brand").trim() || "#f4c430");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dots = [], last = 0;
  let clock = still ? PHASES[0] + PHASES[1] + 0.5 : 0;

  function birdPoints() {
    // Sample the bird on a grid; right of the text on wide screens,
    // centred behind it on narrow ones.
    const wide = w > 820;
    const size = wide ? Math.min(h * 0.7, w * 0.42) : Math.min(w * 0.9, h * 0.55);
    const ox = wide ? w * 0.74 - size / 2 : (w - size) / 2;
    const oy = (h - size) / 2;
    const k = size / 100;
    const off = document.createElement("canvas").getContext("2d");
    const step = Math.max(4.2, size / 88);
    const pts = [];
    for (let y = oy; y < oy + size; y += step) {
      for (let x = ox; x < ox + size; x += step) {
        const bx = (x - ox) / k, by = (y - oy) / k;
        const inEye = Math.hypot(bx - EYE.x, by - EYE.y) < EYE.r;
        if (!inEye && BIRD_PARTS.some((part) => off.isPointInPath(part, bx, by))) pts.push([x + (Math.random() - 0.5) * step * 0.4, y + (Math.random() - 0.5) * step * 0.4]);
      }
    }
    return pts;
  }

  function scatterPoint() {
    const x = Math.random() * w, y = Math.random() * h;
    return { sx: x, sy: y, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, r: 0.7 + Math.random() * 1.2, glow: 0.55 + Math.random() * 0.45, ph: Math.random() * 6.28 };
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const targets = birdPoints();
    const extra = Math.round((targets.length * NOISE_SHARE) / (1 - NOISE_SHARE));
    dots = targets.map(([tx, ty]) => ({ tx, ty, ...scatterPoint(), noise: false }));
    for (let i = 0; i < extra; i++) dots.push({ ...scatterPoint(), noise: true });
  }

  function formedness() {
    const total = PHASES.reduce((a, b) => a + b, 0);
    let t = clock % total;
    const [drift, gather, hold, release] = PHASES;
    if (t < drift) return 0;
    if ((t -= drift) < gather) return ease(t / gather);
    if ((t -= gather) < hold) return 1;
    return 1 - ease((t - hold) / release);
  }

  function draw(t) {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    if (!still) clock += dt;
    const formed = formedness();
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      // Every dot drifts; bird dots are pulled to their place in the bird.
      d.sx += d.vx * dt;
      d.sy += d.vy * dt;
      if (d.sx < 0 || d.sx > w) d.vx *= -1;
      if (d.sy < 0 || d.sy > h) d.vy *= -1;
      const pull = d.noise ? 0 : formed;
      const x = mix(d.sx, d.tx ?? d.sx, pull) + (Math.random() - 0.5) * pull * 0.6;
      const y = mix(d.sy, d.ty ?? d.sy, pull) + (Math.random() - 0.5) * pull * 0.6;
      const c = d.noise ? ink : ink.map((v, i) => Math.round(mix(v, brand[i], pull)));
      // Formed dots shimmer a little, like shots still arriving.
      const shimmer = 0.85 + 0.15 * Math.sin(clock * 3 + d.ph);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${d.noise ? 0.3 : mix(0.35, d.glow * shimmer, pull)})`;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!still) requestAnimationFrame(draw);
  }

  resize();
  new ResizeObserver(() => {
    resize();
    if (still) requestAnimationFrame(draw);
  }).observe(canvas);
  requestAnimationFrame(draw);
}
