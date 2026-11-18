// Canvas plotting: y = f(x) curves and implicit zero contours (marching squares).
import { evaluate } from './evaluate.js';

const X_MIN = -10;
const X_MAX = 10;
const MARGIN = { l: 46, r: 12, t: 10, b: 24 };

/** Rough number of loop iterations one evaluation of `node` performs (nested sums multiply). */
export function iterationCost(node, env = {}) {
  switch (node.type) {
    case 'sum':
    case 'prod': {
      let n = 1000;
      let first = 0;
      try {
        const lo = Math.floor(evaluate(node.from, env) + 0.5);
        const hi = Math.floor(evaluate(node.to, env) + 0.5);
        n = Math.max(0, hi - lo + 1);
        first = lo;
      } catch {
        // bounds depend on an outer index we do not know yet
      }
      const inner = iterationCost(node.body, { ...env, [node.index]: first });
      return n * Math.max(1, inner);
    }
    case 'bin':
    case 'cmp':
      return Math.max(iterationCost(node.left, env), iterationCost(node.right, env));
    case 'neg':
      return iterationCost(node.arg, env);
    case 'call':
    case 'and':
      return Math.max(1, ...node.args.map((a) => iterationCost(a, env)));
    case 'piecewise':
      return Math.max(
        1,
        ...node.cases.flatMap((c) => [iterationCost(c.cond, env), iterationCost(c.value, env)]),
        node.otherwise ? iterationCost(node.otherwise, env) : 1,
      );
    default:
      return 1;
  }
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    grid: cssVar('--grid') || '#e5e7eb',
    axis: cssVar('--axis') || '#6b7280',
    text: cssVar('--muted') || '#6b7280',
    line: cssVar('--accent') || '#2a6fdb',
    surface: cssVar('--surface') || '#fff',
  };
}

function niceStep(range, target) {
  const rough = range / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const m = rough / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

function fmtTick(v, step) {
  if (Math.abs(v) < step * 1e-9) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(1).replace('.0', '').replace('+', '');
  return v.toFixed(Math.min(8, Math.max(0, -Math.floor(Math.log10(step)))));
}

export function fmtValue(v) {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v !== 0 && (Math.abs(v) >= 1e15 || Math.abs(v) < 1e-9)) return v.toExponential(6);
  return String(Number(v.toPrecision(12)));
}

function setupCanvas(canvas) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Draw grid, axes and tick labels; returns coordinate mappers. */
function drawFrame(ctx, w, h, view, pal, labels = {}) {
  const L = MARGIN.l;
  const T = MARGIN.t;
  const pw = Math.max(10, w - MARGIN.l - MARGIN.r);
  const ph = Math.max(10, h - MARGIN.t - MARGIN.b);
  const mx = (x) => L + ((x - view.x0) / (view.x1 - view.x0)) * pw;
  const my = (y) => T + (1 - (y - view.y0) / (view.y1 - view.y0)) * ph;
  const xStep = niceStep(view.x1 - view.x0, Math.max(4, pw / 70));
  const yStep = niceStep(view.y1 - view.y0, Math.max(3, ph / 50));

  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.fillStyle = pal.text;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = Math.ceil(view.x0 / xStep) * xStep; x <= view.x1 + xStep * 1e-9; x += xStep) {
    const px = Math.round(mx(x)) + 0.5;
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    ctx.moveTo(px, T);
    ctx.lineTo(px, T + ph);
    ctx.stroke();
    ctx.fillText(fmtTick(x, xStep), px, T + ph + 6);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = Math.ceil(view.y0 / yStep) * yStep; y <= view.y1 + yStep * 1e-9; y += yStep) {
    const py = Math.round(my(y)) + 0.5;
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    ctx.moveTo(L, py);
    ctx.lineTo(L + pw, py);
    ctx.stroke();
    ctx.fillText(fmtTick(y, yStep), L - 7, py);
  }

  ctx.strokeStyle = pal.axis;
  ctx.lineWidth = 1.25;
  if (view.y0 <= 0 && view.y1 >= 0) {
    const py = Math.round(my(0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(L, py);
    ctx.lineTo(L + pw, py);
    ctx.stroke();
  }
  if (view.x0 <= 0 && view.x1 >= 0) {
    const px = Math.round(mx(0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, T);
    ctx.lineTo(px, T + ph);
    ctx.stroke();
  }
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);

  if (labels.x || labels.y) {
    ctx.fillStyle = pal.text;
    ctx.font = 'italic 12px Georgia, serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    if (labels.x) ctx.fillText(labels.x, L + pw - 4, T + ph - 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (labels.y) ctx.fillText(labels.y, L + 5, T + 3);
  }
  return { mx, my, L, T, pw, ph };
}

// ------------------------------------------------------------ y = f(x)

function sampleFunction(def, n = 800, budgetMs = 250) {
  const name = def.params[0];
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1).fill(NaN);
  for (let i = 0; i <= n; i++) xs[i] = X_MIN + ((X_MAX - X_MIN) * i) / n;
  const t0 = performance.now();
  let truncated = false;
  for (let i = 0; i <= n; i++) {
    if ((i & 15) === 0 && performance.now() - t0 > budgetMs) {
      truncated = true;
      break;
    }
    try {
      ys[i] = Number(evaluate(def.body, { [name]: xs[i] }));
    } catch {
      ys[i] = NaN;
    }
  }
  return { xs, ys, truncated };
}

function autoRange(ys) {
  const finite = Array.from(ys).filter((v) => Number.isFinite(v) && Math.abs(v) < 1e12);
  if (!finite.length) return [-1, 1];
  finite.sort((a, b) => a - b);
  const q = (p) => finite[Math.min(finite.length - 1, Math.floor(p * finite.length))];
  let lo = q(0.03);
  let hi = q(0.97);
  const fullLo = finite[0];
  const fullHi = finite[finite.length - 1];
  if (fullHi - fullLo <= 4 * (hi - lo)) {
    lo = fullLo;
    hi = fullHi;
  }
  if (hi - lo < 1e-9) {
    const c = (hi + lo) / 2;
    const half = Math.max(1, Math.abs(c) * 0.5);
    return [c - half, c + half];
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  if (lo > 0 && lo < hi - lo) lo = 0;
  if (hi < 0 && -hi < hi - lo) hi = 0;
  return [lo, hi];
}

/**
 * Attach a function graph to `canvas`. `readout` (optional element) shows the value under the pointer.
 * Returns { setDef(def, message), redraw(), destroy() }.
 */
export function createGraph(canvas, readout) {
  let def = null;
  let message = '';
  let data = null;
  let view = null;
  let layout = null;
  let hoverPx = null;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const size = setupCanvas(canvas);
    if (!size) return;
    const { ctx, w, h } = size;
    const pal = palette();
    if (!def) {
      drawFrame(ctx, w, h, { x0: X_MIN, x1: X_MAX, y0: -5, y1: 5 }, pal);
      if (message) {
        ctx.fillStyle = pal.text;
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, w / 2, h / 2);
      }
      return;
    }
    layout = drawFrame(ctx, w, h, view, pal, { x: def.params[0] });
    const { mx, my, L, T, pw, ph } = layout;
    const yr = view.y1 - view.y0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, T, pw, ph);
    ctx.clip();
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let prev = NaN;
    for (let i = 0; i < data.xs.length; i++) {
      const y = data.ys[i];
      if (!Number.isFinite(y)) {
        prev = NaN;
        continue;
      }
      const px = mx(data.xs[i]);
      const py = Math.max(-1e5, Math.min(1e5, my(y)));
      if (Number.isNaN(prev) || Math.abs(y - prev) > 1.5 * yr) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      prev = y;
    }
    ctx.stroke();
    ctx.restore();

    if (data.truncated) {
      ctx.fillStyle = pal.text;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('partial: too slow to plot fully', L + pw - 6, T + 4);
    }

    if (hoverPx !== null && hoverPx >= L && hoverPx <= L + pw) {
      const x = X_MIN + ((hoverPx - L) / pw) * (X_MAX - X_MIN);
      let y = NaN;
      try {
        y = Number(evaluate(def.body, { [def.params[0]]: x }));
      } catch {
        y = NaN;
      }
      ctx.strokeStyle = pal.axis;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hoverPx) + 0.5, T);
      ctx.lineTo(Math.round(hoverPx) + 0.5, T + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      if (Number.isFinite(y) && y >= view.y0 && y <= view.y1) {
        ctx.fillStyle = pal.line;
        ctx.strokeStyle = pal.surface;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hoverPx, my(y), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (readout)
        readout.textContent = `${def.params[0]} = ${fmtValue(+x.toFixed(4))}    ${def.name}(${def.params[0]}) = ${fmtValue(y)}`;
    } else if (readout) {
      readout.textContent = '';
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const onMove = (e) => {
    hoverPx = e.clientX - canvas.getBoundingClientRect().left;
    schedule();
  };
  const onLeave = () => {
    hoverPx = null;
    schedule();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const ro = new ResizeObserver(schedule);
  ro.observe(canvas);

  return {
    setDef(next, msg = '') {
      def = msg ? null : next;
      message = msg;
      if (def) {
        data = sampleFunction(def);
        const [y0, y1] = autoRange(data.ys);
        view = { x0: X_MIN, x1: X_MAX, y0, y1 };
      }
      schedule();
    },
    redraw: schedule,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

// ------------------------------------------------------- implicit contour

// Marching-squares segment table. Corner bits: tl=1, tr=2, br=4, bl=8; edges: T, R, B, L.
const SEGMENTS = [
  [],
  [['L', 'T']],
  [['T', 'R']],
  [['L', 'R']],
  [['R', 'B']],
  null, // 5: saddle
  [['T', 'B']],
  [['L', 'B']],
  [['B', 'L']],
  [['T', 'B']],
  null, // 10: saddle
  [['R', 'B']],
  [['L', 'R']],
  [['T', 'R']],
  [['L', 'T']],
  [],
];

/**
 * Attach a zero-contour plot of body(x, y) = 0 (over the first two params) to `canvas`.
 * Returns { setDef(def, message), setRange(r), redraw(), destroy() }.
 */
export function createContour(canvas) {
  let def = null;
  let message = '';
  let range = 4;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const size = setupCanvas(canvas);
    if (!size) return;
    const { ctx, w, h } = size;
    const pal = palette();
    // Keep the scale equal on both axes: x spans [-r, r] and y follows the aspect ratio.
    const pw = Math.max(10, w - MARGIN.l - MARGIN.r);
    const ph = Math.max(10, h - MARGIN.t - MARGIN.b);
    const ry = (range * ph) / pw;
    const view = { x0: -range, x1: range, y0: -ry, y1: ry };
    const layout = drawFrame(ctx, w, h, view, pal, {
      x: def ? def.params[0] : '',
      y: def ? def.params[1] : '',
    });
    if (!def) {
      if (message) {
        ctx.fillStyle = pal.text;
        ctx.font = '13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, w / 2, h / 2);
      }
      return;
    }
    const { mx, my, L, T } = layout;
    const cells = 120;
    const cols = cells;
    const rows = Math.max(8, Math.round((cells * ph) / pw));
    const [nx, ny] = def.params;
    const vals = new Float64Array((cols + 1) * (rows + 1)).fill(NaN);
    const t0 = performance.now();
    let partial = false;
    for (let j = 0; j <= rows && !partial; j++) {
      const y = view.y1 - ((view.y1 - view.y0) * j) / rows;
      for (let i = 0; i <= cols; i++) {
        const x = view.x0 + ((view.x1 - view.x0) * i) / cols;
        try {
          vals[j * (cols + 1) + i] = Number(evaluate(def.body, { [nx]: x, [ny]: y }));
        } catch {
          // leave NaN
        }
      }
      if (performance.now() - t0 > 300) partial = true;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(L, T, pw, ph);
    ctx.clip();
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const at = (i, j) => vals[j * (cols + 1) + i];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]; // tl tr br bl
        if (v.some((n) => !Number.isFinite(n))) continue;
        const idx =
          (v[0] > 0 ? 1 : 0) | (v[1] > 0 ? 2 : 0) | (v[2] > 0 ? 4 : 0) | (v[3] > 0 ? 8 : 0);
        let segs = SEGMENTS[idx];
        if (segs === null) {
          const centre = (v[0] + v[1] + v[2] + v[3]) / 4 > 0;
          if (idx === 5)
            segs = centre
              ? [
                  ['T', 'R'],
                  ['B', 'L'],
                ]
              : [
                  ['L', 'T'],
                  ['R', 'B'],
                ];
          else
            segs = centre
              ? [
                  ['L', 'T'],
                  ['R', 'B'],
                ]
              : [
                  ['T', 'R'],
                  ['B', 'L'],
                ];
        }
        if (!segs.length) continue;
        const x0 = view.x0 + ((view.x1 - view.x0) * i) / cols;
        const x1 = view.x0 + ((view.x1 - view.x0) * (i + 1)) / cols;
        const y0 = view.y1 - ((view.y1 - view.y0) * j) / rows;
        const y1 = view.y1 - ((view.y1 - view.y0) * (j + 1)) / rows;
        const lerp = (a, b, va, vb) => a + ((b - a) * va) / (va - vb);
        const point = {
          T: () => [lerp(x0, x1, v[0], v[1]), y0],
          B: () => [lerp(x0, x1, v[3], v[2]), y1],
          L: () => [x0, lerp(y0, y1, v[0], v[3])],
          R: () => [x1, lerp(y0, y1, v[1], v[2])],
        };
        for (const [a, b] of segs) {
          const [ax, ay] = point[a]();
          const [bx, by] = point[b]();
          ctx.moveTo(mx(ax), my(ay));
          ctx.lineTo(mx(bx), my(by));
        }
      }
    }
    ctx.stroke();
    ctx.restore();
    if (partial) {
      ctx.fillStyle = pal.text;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('partial: too slow to plot fully', L + pw - 6, T + 4);
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const ro = new ResizeObserver(schedule);
  ro.observe(canvas);

  return {
    setDef(next, msg = '') {
      def = msg ? null : next;
      message = msg;
      schedule();
    },
    setRange(r) {
      range = r;
      schedule();
    },
    redraw: schedule,
    destroy() {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
