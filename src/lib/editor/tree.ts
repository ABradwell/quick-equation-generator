// Tree primitives shared by model.ts and latex.ts (no DOM).
// See the JSDoc block at the top of model.ts for the data model.
import type {
  Atom,
  AtomClass,
  BigOp,
  Block,
  CloseBracket,
  Item,
  MathNode,
  NodeKind,
  OpenBracket,
} from './types.ts';

let counter = 0;
const uid = (prefix: string): string => `${prefix}${++counter}`;

export const CLOSE_OF: Record<OpenBracket, CloseBracket> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '|': '|',
};
export const OPEN_OF: Record<string, OpenBracket> = { ')': '(', ']': '[', '}': '{' };

type Maybe = { kind: string } | null | undefined;
export const isBlock = (x: Maybe): x is Block => x?.kind === 'block';
export const isAtom = (x: Maybe): x is Atom => x?.kind === 'atom';
export const isNode = (x: Maybe): x is MathNode => !!x && x.kind !== 'block' && x.kind !== 'atom';

/** Create a block that adopts `items` (their `parent` is set to the new block). */
export function makeBlock(items: Item[] = [], parent: MathNode | null = null): Block {
  const block: Block = { kind: 'block', id: uid('b'), items: [...items], parent };
  for (const item of block.items) item.parent = block;
  return block;
}

export function makeAtom(text: string, latex: string = text, cls: AtomClass = 'var'): Atom {
  return { kind: 'atom', id: uid('a'), text, latex, cls, parent: null };
}

/** Generic node: `blockItems` is an array of item arrays, one per block. */
export function makeNode(
  kind: NodeKind,
  blockItems: Item[][],
  props: Partial<Pick<MathNode, 'open' | 'close' | 'op'>> = {},
): MathNode {
  const node: MathNode = { kind, id: uid('n'), parent: null, blocks: [], ...props };
  node.blocks = blockItems.map((items) => makeBlock(items, node));
  return node;
}

export const makeFrac = (num: Item[] = [], den: Item[] = []): MathNode =>
  makeNode('frac', [num, den]);
export const makeScript = (kind: 'sup' | 'sub', items: Item[] = []): MathNode =>
  makeNode(kind, [items]);
export function makeSqrt(arg: Item[] = [], index: Item[] | null = null): MathNode {
  const node = makeNode('sqrt', [arg]);
  if (index) node.index = makeBlock(index, node);
  return node;
}
export const makeParen = (open: OpenBracket, items: Item[] = []): MathNode =>
  makeNode('paren', [items], { open, close: CLOSE_OF[open] });
export const makeBigop = (op: BigOp, lower: Item[] = [], upper: Item[] = []): MathNode =>
  makeNode('bigop', [lower, upper], { op });

/** The blocks of a node in navigation order (a radical's index comes first). */
export function blocksOf(node: MathNode): Block[] {
  return node.index ? [node.index, ...node.blocks] : node.blocks;
}

/** Position of an item in its parent block. */
export const indexOfItem = (item: Item): number => item.parent!.items.indexOf(item);

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

export const GREEK: Record<string, string> = {
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

export const GREEK_BY_CHAR: Record<string, string> = Object.fromEntries(
  Object.entries(GREEK).map(([k, v]) => [v, k]),
);

export const CONSTANTS: Record<string, string> = { pi: 'π', tau: 'τ' };

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

export const fnLatex = (name: string): string =>
  STANDARD_LATEX_FUNCTIONS.has(name) ? `\\${name}` : `\\operatorname{${name}}`;
export const fnAtom = (name: string): Atom => makeAtom(name, fnLatex(name), 'fn');
export const greekAtom = (name: string): Atom => makeAtom(GREEK[name], `\\${name}`, 'greek');
export const constAtom = (name: string): Atom => makeAtom(CONSTANTS[name], `\\${name}`, 'const');

/** The item an auto-word turns into (atom or node), or null if `name` is not a word. */
export function makeWord(name: string): Item | null {
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
export function atomForChar(ch: string): Atom | null {
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
