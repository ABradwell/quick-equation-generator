import type { BinNode, CallNode, Definition, LoopNode, Node, PiecewiseNode } from '../ast.ts';
import type { Emitted } from './shared.ts';
import {
  PREC,
  collectNames,
  docComment,
  docLines,
  lineComment,
  type GenMeta,
  floatLiteral,
  isNegativeNumber,
  literalBound,
  makeFresh,
  prepareDefinition,
  safeName,
  usedVars,
  walk,
  wrap,
} from './shared.ts';

const RESERVED = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for',
  'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return',
  'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use',
  'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final',
  'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try', 'gen',
]); // prettier-ignore

const UNARY: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', asinh: 'asinh', acosh: 'acosh', atanh: 'atanh',
  exp: 'exp', ln: 'ln', log10: 'log10', sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs',
  floor: 'floor', ceil: 'ceil',
}; // prettier-ignore

const CONSTS: Record<string, string> = { pi: 'PI', tau: 'TAU', e: 'E' };
const ind = (n: number): string => '    '.repeat(n);
const name = (n: string): string => safeName(n, RESERVED);

/** Integer value of an exponent node like `2` or `-2`, or null. */
function intExponent(node: Node): number | null {
  let sign = 1;
  if (node.type === 'neg') {
    sign = -1;
    node = node.arg;
  }
  if (node.type !== 'num' || !Number.isInteger(node.value) || Math.abs(node.value) > 1e9)
    return null;
  return sign * node.value;
}

/**
 * Does the expression have a concrete f64 type on its own? Untyped float
 * literals cannot be method receivers (`2.0.sqrt()` is an error in Rust).
 */
function typed(node: Node): boolean {
  switch (node.type) {
    case 'num':
      return false;
    case 'neg':
      return typed(node.arg);
    case 'bin':
      return node.op === '^' || typed(node.left) || typed(node.right);
    case 'piecewise':
      return !node.otherwise || node.cases.some((c) => typed(c.value)) || typed(node.otherwise);
    default:
      return true;
  }
}

export function generate(input: Definition, meta?: GenMeta): string {
  const { def, constants } = prepareDefinition(input, meta, (n) => name(n) !== n);
  const fresh = makeFresh(collectNames(def));

  // Every emit* returns { s: source, p: precedence }; `lvl` is the indent of the line it starts on.
  // `force` asks for the expression to carry an explicit f64 type (via a literal suffix).
  function emit(node: Node, lvl: number, force = false): Emitted {
    switch (node.type) {
      case 'num': {
        const neg = isNegativeNumber(node);
        return {
          s: `${neg ? '-' : ''}${floatLiteral(node.value)}${force ? '_f64' : ''}`,
          p: neg ? PREC.UNARY : PREC.ATOM,
        };
      }
      case 'const':
        return { s: `std::f64::consts::${CONSTS[node.name]}`, p: PREC.ATOM };
      case 'var':
        return { s: name(node.name), p: PREC.ATOM };
      case 'neg':
        return { s: `-${wrap(emit(node.arg, lvl, force), PREC.UNARY + 1)}`, p: PREC.UNARY };
      case 'bin':
        return emitBin(node, lvl, force);
      case 'call':
        return emitCall(node, lvl);
      case 'sum':
      case 'prod':
        return { s: `{\n${loopStmts(node, lvl + 1)}\n${ind(lvl)}}`, p: PREC.LOWEST };
      case 'piecewise':
        return emitPiecewise(node, lvl, force);
      case 'cmp':
        return {
          s: `${wrap(emit(node.left, lvl), PREC.ADD)} ${node.op} ${wrap(emit(node.right, lvl), PREC.ADD)}`,
          p: PREC.CMP,
        };
      case 'and':
        return { s: node.args.map((a) => wrap(emit(a, lvl), PREC.CMP)).join(' && '), p: PREC.AND };
      default:
        throw new Error(`Unknown node ${(node as Node).type}`);
    }
  }

  /** Receiver of a method call: typed and parenthesized unless atomic. */
  function recv(node: Node, lvl: number): string {
    return wrap(emit(node, lvl, !typed(node)), PREC.ATOM);
  }

  function emitBin(node: BinNode, lvl: number, force: boolean): Emitted {
    if (node.op === '^') {
      const n = intExponent(node.right);
      const base = recv(node.left, lvl);
      if (n !== null) return { s: `${base}.powi(${n})`, p: PREC.ATOM };
      return { s: `${base}.powf(${emit(node.right, lvl).s})`, p: PREC.ATOM };
    }
    const p = node.op === '+' || node.op === '-' ? PREC.ADD : PREC.MUL;
    const l = wrap(emit(node.left, lvl, force), p);
    const r = wrap(emit(node.right, lvl), p + 1);
    return { s: `${l} ${node.op} ${r}`, p };
  }

  function emitCall(node: CallNode, lvl: number): Emitted {
    const atom = (s: string): Emitted => ({ s, p: PREC.ATOM });
    if (UNARY[node.fn]) return atom(`${recv(node.args[0], lvl)}.${UNARY[node.fn]}()`);
    switch (node.fn) {
      case 'atan2':
        return atom(`${recv(node.args[0], lvl)}.atan2(${emit(node.args[1], lvl).s})`);
      case 'min':
      case 'max': {
        const [first, ...rest] = node.args;
        return atom(
          rest.reduce((acc, a) => `${acc}.${node.fn}(${emit(a, lvl).s})`, recv(first, lvl)),
        );
      }
      case 'sign': {
        const arg = node.args[0];
        if (arg.type === 'var') {
          const v = name(arg.name);
          return {
            s: `if ${v} > 0.0 { 1.0 } else if ${v} < 0.0 { -1.0 } else { ${v} }`,
            p: PREC.LOWEST,
          };
        }
        const v = fresh('v');
        const s = [
          '{',
          `${ind(lvl + 1)}let ${v} = ${emit(arg, lvl + 1, !typed(arg)).s};`,
          `${ind(lvl + 1)}if ${v} > 0.0 { 1.0 } else if ${v} < 0.0 { -1.0 } else { ${v} }`,
          `${ind(lvl)}}`,
        ].join('\n');
        return { s, p: PREC.LOWEST };
      }
      default:
        throw new Error(`Unknown function ${node.fn}`);
    }
  }

  /** Statements (ending in a tail expression) that compute a sum/prod, at indent `lvl`. */
  function loopStmts(node: LoopNode, lvl: number): string {
    const isSum = node.type === 'sum';
    const acc = fresh(isSum ? 'sum' : 'prod');
    const hi = fresh('hi');
    const k = name(node.index);
    const bound = (b: Node): string =>
      literalBound(b) ?? `(${wrap(emit(b, lvl, !typed(b)), PREC.ADD)} + 0.5).floor()`;
    return [
      `${ind(lvl)}let mut ${acc}: f64 = ${isSum ? '0.0' : '1.0'};`,
      `${ind(lvl)}let ${hi}: f64 = ${bound(node.to)};`,
      `${ind(lvl)}let mut ${k}: f64 = ${bound(node.from)};`,
      `${ind(lvl)}while ${k} <= ${hi} {`,
      `${ind(lvl + 1)}${acc} ${isSum ? '+=' : '*='} ${emit(node.body, lvl + 1).s};`,
      `${ind(lvl + 1)}${k} += 1.0;`,
      `${ind(lvl)}}`,
      `${ind(lvl)}${acc}`,
    ].join('\n');
  }

  function emitPiecewise(node: PiecewiseNode, lvl: number, force: boolean): Emitted {
    const lines: string[] = [];
    node.cases.forEach((c, i) => {
      lines.push(
        `${i ? ' else ' : ''}if ${emit(c.cond, lvl).s} {\n${ind(lvl + 1)}${emit(c.value, lvl + 1, force && i === 0).s}\n${ind(lvl)}}`,
      );
    });
    const other = node.otherwise ? emit(node.otherwise, lvl + 1).s : 'f64::NAN';
    return { s: `${lines.join('')} else {\n${ind(lvl + 1)}${other}\n${ind(lvl)}}`, p: PREC.LOWEST };
  }

  const fname = name(def.name);
  const params = def.params.map(name);
  const used = usedVars(def.body);
  const allows: string[] = [];
  const allNames = [fname, ...params];
  walk(def.body, (n) => {
    if (n.type === 'sum' || n.type === 'prod') allNames.push(name(n.index));
  });
  if (allNames.some((n) => /[A-Z]/.test(n))) allows.push('non_snake_case');
  if (def.params.some((p) => !used.has(p))) allows.push('unused_variables');

  const top = def.body;
  const bodySrc =
    top.type === 'sum' || top.type === 'prod' ? loopStmts(top, 1) : `${ind(1)}${emit(top, 1).s}`;
  return [
    ...constants.map(
      (c) =>
        `#[allow(non_upper_case_globals)]\nconst ${c.name}: f64 = ${floatLiteral(c.value)}; // ${c.about}\n`,
    ),
    constants.length ? '\n' : '',
    `${lineComment('///', docLines(def, meta, fname, params, 'plain') ?? [docComment(fname, params)])}\n`,
    allows.length ? `#[allow(${allows.join(', ')})]\n` : '',
    `fn ${fname}(${params.map((p) => `${p}: f64`).join(', ')}) -> f64 {\n`,
    `${bodySrc}\n`,
    '}',
  ].join('');
}
