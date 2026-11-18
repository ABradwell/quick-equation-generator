// Tree primitives shared by model.js and latex.js (no DOM).
// See the JSDoc block at the top of model.js for the data model.

let counter = 0;
const uid = (prefix) => `${prefix}${++counter}`;

export const CLOSE_OF = { '(': ')', '[': ']', '{': '}', '|': '|' };
export const OPEN_OF = { ')': '(', ']': '[', '}': '{' };

export const isBlock = (x) => x?.kind === 'block';
export const isAtom = (x) => x?.kind === 'atom';
export const isNode = (x) => !!x && x.kind !== 'block' && x.kind !== 'atom';

/** Create a block that adopts `items` (their `parent` is set to the new block). */
export function makeBlock(items = [], parent = null) {
  const block = { kind: 'block', id: uid('b'), items: [...items], parent };
  for (const item of block.items) item.parent = block;
  return block;
}

export function makeAtom(text, latex = text, cls = 'var') {
  return { kind: 'atom', id: uid('a'), text, latex, cls, parent: null };
}

/** Generic node: `blockItems` is an array of item arrays, one per block. */
export function makeNode(kind, blockItems, props = {}) {
  const node = { kind, id: uid('n'), parent: null, blocks: [], ...props };
  node.blocks = blockItems.map((items) => makeBlock(items, node));
  return node;
}

export const makeFrac = (num = [], den = []) => makeNode('frac', [num, den]);
export const makeScript = (kind, items = []) => makeNode(kind, [items]);
export function makeSqrt(arg = [], index = null) {
  const node = makeNode('sqrt', [arg]);
  if (index) node.index = makeBlock(index, node);
  return node;
}
export const makeParen = (open, items = []) =>
  makeNode('paren', [items], { open, close: CLOSE_OF[open] });
export const makeBigop = (op, lower = [], upper = []) => makeNode('bigop', [lower, upper], { op });

/** The blocks of a node in navigation order (a radical's index comes first). */
export function blocksOf(node) {
  return node.index ? [node.index, ...node.blocks] : node.blocks;
}

/** Position of an item in its parent block. */
export const indexOfItem = (item) => item.parent.items.indexOf(item);

// ---------------------------------------------------------------- words

const STANDARD_LATEX_FUNCTIONS = new Set(
  'sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh exp ln log min max'.split(' '),
);

/** Function names the editor converts to a single atom while typing. */
export const AUTO_FUNCTIONS = (
  'sin cos tan sec csc cot asin acos atan arcsin arccos arctan sinh cosh tanh ' +
  'asinh acosh atanh arcsinh arccosh arctanh exp ln log min max abs floor ceil round sign mod atan2'
).split(' ');

/** Function words fromLatex recognises (mirrors parser.js, `sqrt` is handled separately). */
export const IMPORT_FUNCTIONS = (
  'sin cos tan sec csc cot arcsin arccos arctan asin acos atan sinh cosh tanh arcsinh arccosh ' +
  'arctanh asinh acosh atanh arsinh arcosh artanh atan2 exp ln log cbrt abs floor ceil round ' +
  'sign sgn min max mod'
).split(' ');

export const GREEK = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ϵ',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
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
  varphi: 'ϕ',
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

export const GREEK_BY_CHAR = Object.fromEntries(Object.entries(GREEK).map(([k, v]) => [v, k]));

export const CONSTANTS = { pi: 'π', tau: 'τ' };

/** Every word that auto-converts while typing. */
export const AUTO_WORDS = new Set([
  ...AUTO_FUNCTIONS,
  ...Object.keys(GREEK),
  ...Object.keys(CONSTANTS),
  'sqrt',
  'nthroot',
  'sum',
  'prod',
]);

/** Proper prefixes of auto-words: a word in this set may still grow into a longer one. */
export const AUTO_PREFIXES = new Set(
  [...AUTO_WORDS].flatMap((w) => Array.from({ length: w.length - 1 }, (_, i) => w.slice(0, i + 1))),
);
export const MAX_WORD = Math.max(...[...AUTO_WORDS].map((w) => w.length));

export const fnLatex = (name) =>
  STANDARD_LATEX_FUNCTIONS.has(name) ? `\\${name}` : `\\operatorname{${name}}`;
export const fnAtom = (name) => makeAtom(name, fnLatex(name), 'fn');
export const greekAtom = (name) => makeAtom(GREEK[name], `\\${name}`, 'greek');
export const constAtom = (name) => makeAtom(CONSTANTS[name], `\\${name}`, 'const');

/** The item an auto-word turns into (atom or node), or null if `name` is not a word. */
export function makeWord(name) {
  if (AUTO_FUNCTIONS.includes(name) || IMPORT_FUNCTIONS.includes(name)) return fnAtom(name);
  if (name in GREEK) return greekAtom(name);
  if (name in CONSTANTS) return constAtom(name);
  if (name === 'sqrt') return makeSqrt();
  if (name === 'nthroot') return makeSqrt([], []);
  if (name === 'sum' || name === 'prod') return makeBigop(name);
  return null;
}

// Character atoms ------------------------------------------------------

/** The atom a single typed character produces, or null for characters with other meanings. */
export function atomForChar(ch) {
  if (/^[0-9.]$/.test(ch)) return makeAtom(ch, ch, 'num');
  if (/^[A-Za-z]$/.test(ch)) return makeAtom(ch, ch, 'var');
  switch (ch) {
    case '+':
    case '=':
    case '<':
    case '>':
      return makeAtom(ch, ch, 'op');
    case '-':
    case '−':
      return makeAtom('−', '-', 'op');
    case '*':
    case '·':
    case '×':
    case '∙':
      return makeAtom('·', '\\cdot', 'op');
    case '≤':
      return makeAtom('≤', '\\le', 'op');
    case '≥':
      return makeAtom('≥', '\\ge', 'op');
    case ',':
    case ':':
    case '!':
      return makeAtom(ch, ch, 'punct');
    case 'π':
      return constAtom('pi');
    case 'τ':
      return constAtom('tau');
    default:
      if (ch in GREEK_BY_CHAR) return greekAtom(GREEK_BY_CHAR[ch]);
      return null;
  }
}
