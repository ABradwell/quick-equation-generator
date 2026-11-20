// TypeScript generator: AST (docs/AST.md) -> a standalone exported function.
// Results follow src/lib/evaluate.ts; NaN and Infinity behave as in the reference.

import type { BinNode, CallNode, Definition, LoopNode, Node, PiecewiseNode } from '../ast.ts';
import {
  blockComment,
  collectNames,
  docLines,
  makeFresh,
  prepareDefinition,
  usedVars,
  type GenMeta,
} from './shared.ts';

// Precedence, loosest to tightest, following JavaScript's grammar.
const P = { COND: 0, OR: 1, AND: 2, CMP: 3, ADD: 4, MUL: 5, UNARY: 6, POW: 7, ATOM: 8 };

// Reserved words, plus globals the generated code uses (a parameter named Math would shadow it).
const RESERVED = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'undefined',
  'NaN',
  'Infinity',
  'Math',
]);

const CONSTS: Record<string, string> = { pi: 'Math.PI', tau: '(2 * Math.PI)', e: 'Math.E' };

// Functions that are the same name under Math, except ln -> Math.log.
const MATH_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'log10',
  'sqrt',
  'cbrt',
  'abs',
  'floor',
  'ceil',
  'sign',
  'min',
  'max',
]);

const JS_CMP: Partial<Record<string, string>> = { '==': '===' };

function ident(name: string): string {
  return RESERVED.has(name) ? `${name}_` : name;
}

/** Source text of a node, plus its precedence. */
type Emitted = [code: string, prec: number];

function expr(node: Node): Emitted {
  switch (node.type) {
    case 'num':
      return [String(node.value), P.ATOM];
    case 'const':
      return [CONSTS[node.name], P.ATOM];
    case 'var':
      return [ident(node.name), P.ATOM];
    case 'neg':
      // Always parenthesise the operand: -x ** 2 is a syntax error, and -(-x) avoids "--".
      return [`-${wrap(node.arg, P.ATOM)}`, P.UNARY];
    case 'bin':
      return binary(node);
    case 'call':
      return [call(node), P.ATOM];
    case 'sum':
    case 'prod':
      return [loop(node), P.ATOM];
    case 'piecewise':
      return [piecewise(node), P.ATOM];
    case 'cmp':
      return [
        `${wrap(node.left, P.ADD)} ${JS_CMP[node.op] ?? node.op} ${wrap(node.right, P.ADD)}`,
        P.CMP,
      ];
    case 'and':
      return [node.args.map(text).join(' && '), P.AND];
    default:
      throw new Error(`typescript generator: unsupported node "${(node as Node).type}"`);
  }
}

const text = (node: Node): string => expr(node)[0];

/** Source of a node, parenthesised when its precedence is below `min`. */
function wrap(node: Node, min: number): string {
  const [code, prec] = expr(node);
  return prec >= min ? code : `(${code})`;
}

function binary({ op, left, right }: BinNode): Emitted {
  switch (op) {
    case '+':
    case '-':
      return [`${wrap(left, P.ADD)} ${op} ${wrap(right, P.MUL)}`, P.ADD];
    case '*':
    case '/':
      return [`${wrap(left, P.MUL)} ${op} ${wrap(right, P.UNARY)}`, P.MUL];
    case '^':
      // ** cannot take a unary left operand, so (-x) ** 2 keeps its parentheses.
      return [`${wrap(left, P.ATOM)} ** ${wrap(right, P.UNARY)}`, P.POW];
    default:
      throw new Error(`typescript generator: unknown operator "${op as string}"`);
  }
}

function call({ fn, args }: CallNode): string {
  if (!MATH_FUNCS.has(fn) && fn !== 'ln') {
    throw new Error(`typescript generator: unknown function "${fn}"`);
  }
  const parts = args.map(text);
  const name = fn === 'ln' ? 'log' : fn;
  return `Math.${name}(${parts.join(', ')})`;
}

/** Statements being collected for the block currently being emitted, and their indent. */
interface Block {
  lines: string[];
  lvl: number;
}

const ind = (n: number): string => '    '.repeat(n);

// State for the generate() call in progress. Loops are emitted as statements into `block`,
// and the loop's accumulator stands in for it in the enclosing expression.
let block: Block = { lines: [], lvl: 1 };
let fresh: (base: string) => string = (base) => base;

/** Run `fn` with a fresh statement block at indent `lvl`; returns its result and statements. */
function inBlock<T>(lvl: number, fn: () => T): [T, string[]] {
  const outer = block;
  block = { lines: [], lvl };
  try {
    return [fn(), block.lines];
  } finally {
    block = outer;
  }
}

/** Constant loop bound floor(x + 0.5) as a literal, or null when `node` is not a number. */
function literalBound(node: Node): string | null {
  return node.type === 'num' && Number.isFinite(node.value)
    ? String(Math.floor(node.value + 0.5))
    : null;
}

function loop(node: LoopNode): string {
  const { lines, lvl } = block;
  const isSum = node.type === 'sum';
  const index = ident(node.index);
  // Bounds are emitted first: a loop inside a bound runs before this one.
  const from = literalBound(node.from) ?? `Math.floor(${text(node.from)} + 0.5)`;
  const to = literalBound(node.to) ?? `Math.floor(${text(node.to)} + 0.5)`;
  const acc = fresh(isSum ? 'sum' : 'prod');
  lines.push(`${ind(lvl)}let ${acc} = ${isSum ? 0 : 1};`);
  // `let k = <from>` cannot read an outer k (temporal dead zone), so such a bound gets a name.
  let lo = from;
  if (literalBound(node.from) === null && usedVars(node.from).has(node.index)) {
    lo = fresh('lo');
    lines.push(`${ind(lvl)}const ${lo} = ${from};`);
  }
  let hi = to;
  if (literalBound(node.to) === null) {
    hi = fresh('hi');
    lines.push(`${ind(lvl)}const ${hi} = ${to};`);
  }
  const [body, stmts] = inBlock(lvl + 1, () => text(node.body));
  lines.push(
    `${ind(lvl)}for (let ${index} = ${lo}; ${index} <= ${hi}; ${index}++) {`,
    ...stmts,
    `${ind(lvl + 1)}${acc} ${isSum ? '+=' : '*='} ${body};`,
    `${ind(lvl)}}`,
  );
  return acc;
}

/**
 * One condition or value of a piecewise. A loop inside it must only run when the branch is
 * reached, so its statements go in an immediately invoked arrow function instead of the
 * enclosing block.
 */
function arm(node: Node): string {
  const lvl = block.lvl;
  const [code, stmts] = inBlock(lvl + 1, () => text(node));
  if (!stmts.length) return code;
  return ['(() => {', ...stmts, `${ind(lvl + 1)}return ${code};`, `${ind(lvl)}})()`].join('\n');
}

function piecewise({ cases, otherwise }: PiecewiseNode): string {
  // Arms are emitted in source order so scratch names number in reading order.
  const arms = cases.map((c) => [arm(c.cond), arm(c.value)]);
  let out = otherwise ? arm(otherwise) : 'NaN';
  for (let i = arms.length - 1; i >= 0; i--) {
    out = `${arms[i][0]} ? ${arms[i][1]} : ${out}`;
  }
  return `(${out})`;
}

export function generate(input: Definition, meta?: GenMeta): string {
  const { def, constants } = prepareDefinition(input, meta, (n) => ident(n) !== n);
  const params = def.params.map((p) => `${ident(p)}: number`).join(', ');
  fresh = makeFresh(collectNames(def));
  const [result, stmts] = inBlock(1, () => text(def.body));
  return [
    ...constants.flatMap((c) => [`const ${c.name} = ${c.value}; // ${c.about}`, '']),
    blockComment(
      docLines(def, meta, ident(def.name), def.params.map(ident), 'jsdoc') ?? [
        `Evaluate ${def.name}(${def.params.join(', ')}).`,
      ],
    ),
    `export function ${ident(def.name)}(${params}): number {`,
    ...stmts,
    `    return ${result};`,
    '}',
    '',
  ].join('\n');
}
