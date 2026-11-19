// Typesets an AST (docs/AST.md) as HTML styled by the .m-* rules in style.css.
// Pure string building; every piece of text is escaped.
import type { BinNode, CallNode, Definition, LoopNode, Node, PiecewiseNode } from './ast.ts';

const GREEK: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  rho: 'ρ',
  sigma: 'σ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

const FN_LABELS: Record<string, string> = {
  asin: 'arcsin',
  acos: 'arccos',
  atan: 'arctan',
  asinh: 'arsinh',
  acosh: 'arcosh',
  atanh: 'artanh',
  log10: 'log<span class="m-sub">10</span>',
};

// Functions that read naturally as sin²(x).
const POWER_FIRST = new Set(['sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'ln', 'log10']);
const BRACKET_FNS = new Set(['sqrt', 'cbrt', 'abs', 'floor', 'ceil']);
const CMP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '<=': '≤', '>=': '≥', '==': '=' };

// Binding strength used to decide where parentheses are needed.
const P_ADD = 1;
const P_NEG = 1.5;
const P_MUL = 2;
const P_FRAC = 3.5;
const P_POW = 4;
const P_ATOM = 5;

export function escapeHtml(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
const esc = escapeHtml;

// ------------------------------------------------------------ identifiers

function identPart(word: string): string {
  if (/^\d+$/.test(word)) return `<span class="m-n">${esc(word)}</span>`;
  if (Object.hasOwn(GREEK, word)) {
    const upper = word[0] === word[0].toUpperCase();
    return `<span class="${upper ? 'm-c' : 'm-v'}">${GREEK[word]}</span>`;
  }
  if (word.length === 1) return `<span class="m-v">${esc(word)}</span>`;
  return `<span class="m-id">${esc(word)}</span>`;
}

/** Typeset a variable / function name: theta -> θ, x_1 -> x with subscript 1, v_max -> v with "max". */
export function renderIdentifier(name: string): string {
  const i = name.indexOf('_');
  const base = i < 0 ? name : name.slice(0, i);
  const sub = i < 0 ? '' : name.slice(i + 1);
  return identPart(base) + (sub ? `<span class="m-sub">${identPart(sub)}</span>` : '');
}

const isMultiLetterVar = (n: Node): boolean =>
  n.type === 'var' &&
  (() => {
    const base = n.name.split('_')[0];
    return base.length > 1 && !Object.hasOwn(GREEK, base);
  })();

// ---------------------------------------------------------------- helpers

function fmtNum(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const s = String(Math.abs(value));
  const m = /^([\d.]+)e([+-]?\d+)$/.exec(s);
  if (m) return `${esc(m[1])}×10${sup(esc(m[2].replace('+', '').replace('-', '−')), false, false)}`;
  return esc(s);
}

function sup(inner: string, baseTall: boolean, expTall: boolean): string {
  const raise = (baseTall ? 1.2 : 0.45) + (expTall ? 0.3 : 0);
  return `<span class="m-sup" style="vertical-align:${(raise / 0.7).toFixed(2)}em">${inner}</span>`;
}

/** Does the rendered node contain a stacked fraction, big operator or brace (i.e. is it taller than a line)? */
function tall(n: Node): boolean {
  switch (n.type) {
    case 'bin':
      return n.op === '/' || tall(n.left) || tall(n.right);
    case 'neg':
      return tall(n.arg);
    case 'call':
      return n.args.some(tall);
    case 'sum':
    case 'prod':
    case 'piecewise':
      return true;
    default:
      return false;
  }
}

const isBigOp = (n: Node): boolean => n.type === 'sum' || n.type === 'prod';

function stretch(inner: string, left: string, right: string): string {
  return `<span class="m-big"><span class="${left}"></span><span class="m-in">${inner}</span><span class="${right}"></span></span>`;
}

function paren(inner: string, isTall: boolean): string {
  return isTall
    ? stretch(inner, 'm-lp', 'm-rp')
    : `<span class="m-p">(</span>${inner}<span class="m-p">)</span>`;
}

/** Render a child, adding parentheses when it binds more loosely than `min`. */
function R(node: Node, min = 0): string {
  const { h, p } = raw(node);
  return p < min ? paren(h, tall(node)) : h;
}

// ------------------------------------------------------------------- nodes

/** Rendered HTML and its binding strength. */
interface Rendered {
  h: string;
  p: number;
}

function raw(n: Node): Rendered {
  switch (n.type) {
    case 'num':
      return n.value < 0
        ? {
            h: `<span class="m-minus">−</span><span class="m-n">${fmtNum(n.value)}</span>`,
            p: P_NEG,
          }
        : { h: `<span class="m-n">${fmtNum(n.value)}</span>`, p: P_ATOM };
    case 'const':
      return {
        h: `<span class="m-c">${n.name === 'pi' ? 'π' : n.name === 'tau' ? 'τ' : 'e'}</span>`,
        p: P_ATOM,
      };
    case 'var':
      return { h: renderIdentifier(n.name), p: P_ATOM };
    case 'neg':
      return { h: `<span class="m-minus">−</span>${R(n.arg, P_MUL)}`, p: P_NEG };
    case 'bin':
      return rawBin(n);
    case 'call':
      return { h: rawCall(n), p: P_ATOM };
    case 'sum':
    case 'prod':
      return { h: rawBigOp(n), p: P_MUL };
    case 'piecewise':
      return { h: rawPiecewise(n), p: P_ATOM };
    case 'cmp':
    case 'and':
      return { h: renderCond(n), p: 0 };
    default:
      return { h: '<span class="m-err">?</span>', p: P_ATOM };
  }
}

function rawBin(n: BinNode): Rendered {
  const { op, left, right } = n;
  if (op === '+' || op === '-') {
    const sign = op === '+' ? '+' : '−';
    return { h: `${R(left, P_ADD)}<span class="m-op">${sign}</span>${R(right, P_MUL)}`, p: P_ADD };
  }
  if (op === '/') {
    return {
      h: `<span class="m-frac"><span class="m-num">${R(left)}</span><span class="m-den">${R(right)}</span></span>`,
      p: P_FRAC,
    };
  }
  if (op === '^') return rawPow(n);

  // Multiplication. A sum/product on the left would swallow what follows, so bracket it.
  const lh = isBigOp(left) ? paren(raw(left).h, true) : R(left, P_MUL);
  const rr = raw(right);
  const wrapped = rr.p < P_FRAC - 0.5 && !isBigOp(right);
  const rh = wrapped ? paren(rr.h, tall(right)) : rr.h;
  let sep: string;
  if (canJuxtapose(left, right, wrapped)) {
    const thin = [left, right].some(
      (x) =>
        isBigOp(x) ||
        isMultiLetterVar(x) ||
        x.type === 'call' ||
        (x.type === 'bin' && x.op === '/'),
    );
    sep = thin ? '<span class="m-thin"></span>' : '';
  } else {
    sep = '<span class="m-op m-dot">·</span>';
  }
  return { h: lh + sep + rh, p: P_MUL };
}

function canJuxtapose(left: Node, right: Node, rightWrapped: boolean): boolean {
  // 2·3, x²·3 : two digits would run together.
  if (right.type === 'num') return false;
  if (right.type === 'bin' && right.op === '^' && right.left.type === 'num') return false;
  if (right.type === 'piecewise') return false;
  // 2·(a/b) would read as a mixed number; (a/b)·(c/d) is clearer with a dot.
  if (right.type === 'bin' && right.op === '/') {
    if (left.type === 'num' || (left.type === 'bin' && left.op === '/')) return false;
  }
  // sin(x)·(x+1) must not look like sin applied twice.
  if (rightWrapped && left.type === 'call' && !BRACKET_FNS.has(left.fn)) return false;
  return true;
}

function fnLabel(fn: string): string {
  return `<span class="m-fn">${FN_LABELS[fn] ?? esc(fn)}</span>`;
}

function argList(n: CallNode): string {
  return paren(n.args.map((a) => R(a)).join('<span class="m-comma">,</span> '), n.args.some(tall));
}

function rawPow(n: BinNode): Rendered {
  const { left, right } = n;
  if (
    left.type === 'call' &&
    POWER_FIRST.has(left.fn) &&
    right.type === 'num' &&
    right.value > 0 &&
    !left.args.some(tall)
  ) {
    return { h: `${fnLabel(left.fn)}${sup(R(right), false, false)}${argList(left)}`, p: P_POW };
  }
  return { h: R(left, P_ATOM) + sup(R(right), tall(left), tall(right)), p: P_POW };
}

const RADICAL_PATH = 'M0.5 15 L3 13.2 L6.2 23 L12 0.6';

function radical(inner: string, index?: string): string {
  const idx = index ? `<span class="m-idx">${index}</span>` : '';
  return (
    `<span class="m-sqrt">${idx}<span class="m-rad">` +
    `<svg viewBox="0 0 12 24" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${RADICAL_PATH}"/></svg>` +
    `</span><span class="m-rc">${inner}</span></span>`
  );
}

function rawCall(n: CallNode): string {
  const { fn, args } = n;
  const [a] = args;
  switch (fn) {
    case 'sqrt':
      return radical(R(a));
    case 'cbrt':
      return radical(R(a), '3');
    case 'abs':
      return tall(a)
        ? stretch(R(a), 'm-lb', 'm-rb')
        : `<span class="m-p">|</span>${R(a)}<span class="m-p">|</span>`;
    case 'floor':
      return `<span class="m-p">⌊</span>${R(a)}<span class="m-p">⌋</span>`;
    case 'ceil':
      return `<span class="m-p">⌈</span>${R(a)}<span class="m-p">⌉</span>`;
    default:
      return fnLabel(fn) + argList(n);
  }
}

function rawBigOp(n: LoopNode): string {
  const sym = n.type === 'sum' ? '∑' : '∏';
  return (
    `<span class="m-bigop"><span class="m-lim">${R(n.to)}</span><span class="m-sym">${sym}</span>` +
    `<span class="m-lim">${renderIdentifier(n.index)}<span class="m-eq">=</span>${R(n.from)}</span></span>` +
    `<span class="m-sp"></span>${R(n.body, P_MUL)}`
  );
}

function renderCond(c: Node): string {
  if (c.type === 'cmp') {
    return `${R(c.left)}<span class="m-op">${CMP[c.op] ?? esc(c.op)}</span>${R(c.right)}`;
  }
  if (c.type === 'and') {
    const same = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);
    const chained = c.args.every((a, i) => i === 0 || same(a.left, c.args[i - 1].right));
    if (chained) {
      return (
        R(c.args[0].left) +
        c.args
          .map((a) => `<span class="m-op">${CMP[a.op] ?? esc(a.op)}</span>${R(a.right)}`)
          .join('')
      );
    }
    return c.args.map(renderCond).join('<span class="m-op m-word">and</span>');
  }
  return R(c);
}

const BRACE_PATH =
  'M9 1 C5 1 5 4 5 10 L5 40 C5 46 3 50 0.5 50 C3 50 5 54 5 60 L5 90 C5 96 5 99 9 99';

function rawPiecewise(n: PiecewiseNode): string {
  const row = (value: Node, cond: string) =>
    `<span class="m-pv">${R(value)}</span><span class="m-pc">${cond}</span>`;
  const rows = n.cases.map((c) =>
    row(c.value, `<span class="m-if">if</span>${renderCond(c.cond)}`),
  );
  if (n.otherwise) rows.push(row(n.otherwise, '<span class="m-if">otherwise</span>'));
  return (
    `<span class="m-pw"><span class="m-brace"><svg viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${BRACE_PATH}"/></svg></span>` +
    `<span class="m-rows">${rows.join('')}</span></span>`
  );
}

// -------------------------------------------------------------- public API

/** Typeset an expression AST. */
export function renderMath(ast: Node): string {
  return `<span class="m-math">${R(ast)}</span>`;
}

/** Typeset `name(params) = body`; implicit equations are shown as `body = 0`. */
export function renderDefinition(
  def: Pick<Definition, 'name' | 'params' | 'body' | 'kind'>,
): string {
  const body = R(def.body);
  const eq = '<span class="m-op m-eq-sign">=</span>';
  if (def.kind === 'implicit') {
    return `<span class="m-math">${body}${eq}<span class="m-n">0</span></span>`;
  }
  const params = def.params.map(renderIdentifier).join('<span class="m-comma">,</span> ');
  const lhs = def.params.length
    ? `${renderIdentifier(def.name)}<span class="m-p">(</span>${params}<span class="m-p">)</span>`
    : renderIdentifier(def.name);
  return `<span class="m-math">${lhs}${eq}${body}</span>`;
}
