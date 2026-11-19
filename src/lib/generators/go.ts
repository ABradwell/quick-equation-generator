import type { BinNode, CallNode, Definition, LoopNode, Node, PiecewiseNode } from '../ast.ts';
import type { Emitted } from './shared.ts';
import {
  PREC,
  collectNames,
  docComment,
  floatLiteral,
  isNegativeNumber,
  literalBound,
  makeFresh,
  safeName,
  wrap,
} from './shared.ts';

const RESERVED = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var',
  // Names the generated code relies on, or that cannot be used as a function name.
  'math', 'float64', 'init', 'main', 'nil', 'true', 'false',
]); // prettier-ignore

const UNARY: Record<string, string> = {
  sin: 'Sin', cos: 'Cos', tan: 'Tan', asin: 'Asin', acos: 'Acos', atan: 'Atan',
  sinh: 'Sinh', cosh: 'Cosh', tanh: 'Tanh', asinh: 'Asinh', acosh: 'Acosh', atanh: 'Atanh',
  exp: 'Exp', ln: 'Log', log10: 'Log10', sqrt: 'Sqrt', cbrt: 'Cbrt', abs: 'Abs',
  floor: 'Floor', ceil: 'Ceil',
}; // prettier-ignore

const ind = (n: number): string => '\t'.repeat(n);
const name = (n: string): string => safeName(n, RESERVED);

export function generate(def: Definition): string {
  const fresh = makeFresh(collectNames(def));
  let usesMath = false;
  const M = (fn: string): string => {
    usesMath = true;
    return `math.${fn}`;
  };

  // Every emit* returns { s: source, p: precedence }; `lvl` is the indent of the line it starts on.
  function emit(node: Node, lvl: number): Emitted {
    switch (node.type) {
      case 'num':
        return {
          s: (isNegativeNumber(node) ? '-' : '') + floatLiteral(node.value),
          p: isNegativeNumber(node) ? PREC.UNARY : PREC.ATOM,
        };
      case 'const':
        if (node.name === 'tau') return { s: `2.0 * ${M('Pi')}`, p: PREC.MUL };
        return { s: M(node.name === 'pi' ? 'Pi' : 'E'), p: PREC.ATOM };
      case 'var':
        return { s: name(node.name), p: PREC.ATOM };
      case 'neg':
        return { s: `-${wrap(emit(node.arg, lvl), PREC.UNARY + 1)}`, p: PREC.UNARY };
      case 'bin':
        return emitBin(node, lvl);
      case 'call':
        return emitCall(node, lvl);
      case 'sum':
      case 'prod':
        return emitLoop(node, lvl);
      case 'piecewise':
        return emitPiecewise(node, lvl);
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

  function emitBin(node: BinNode, lvl: number): Emitted {
    if (node.op === '^') {
      return {
        s: `${M('Pow')}(${emit(node.left, lvl).s}, ${emit(node.right, lvl).s})`,
        p: PREC.ATOM,
      };
    }
    const p = node.op === '+' || node.op === '-' ? PREC.ADD : PREC.MUL;
    const l = wrap(emit(node.left, lvl), p);
    const r = wrap(emit(node.right, lvl), p + 1);
    return { s: `${l} ${node.op} ${r}`, p };
  }

  function emitCall(node: CallNode, lvl: number): Emitted {
    const args = node.args.map((a) => emit(a, lvl).s);
    if (UNARY[node.fn]) return { s: `${M(UNARY[node.fn])}(${args[0]})`, p: PREC.ATOM };
    switch (node.fn) {
      case 'atan2':
        return { s: `${M('Atan2')}(${args[0]}, ${args[1]})`, p: PREC.ATOM };
      case 'min':
      case 'max': {
        const fn = M(node.fn === 'min' ? 'Min' : 'Max');
        return { s: args.reduce((acc, a) => `${fn}(${acc}, ${a})`), p: PREC.ATOM };
      }
      case 'sign': {
        const v = fresh('v');
        const s = [
          `func(${v} float64) float64 {`,
          `${ind(lvl + 1)}if ${v} > 0.0 {`,
          `${ind(lvl + 2)}return 1.0`,
          `${ind(lvl + 1)}}`,
          `${ind(lvl + 1)}if ${v} < 0.0 {`,
          `${ind(lvl + 2)}return -1.0`,
          `${ind(lvl + 1)}}`,
          `${ind(lvl + 1)}return ${v}`,
          `${ind(lvl)}}(${args[0]})`,
        ].join('\n');
        return { s, p: PREC.ATOM };
      }
      default:
        throw new Error(`Unknown function ${node.fn}`);
    }
  }

  function emitLoop(node: LoopNode, lvl: number): Emitted {
    const isSum = node.type === 'sum';
    const acc = fresh(isSum ? 'sum' : 'prod');
    const hi = fresh('hi');
    const k = name(node.index);
    const bound = (b: Node): string =>
      literalBound(b) ?? `${M('Floor')}(${wrap(emit(b, lvl + 1), PREC.ADD)} + 0.5)`;
    const body = emit(node.body, lvl + 2).s;
    const s = [
      'func() float64 {',
      `${ind(lvl + 1)}${acc} := ${isSum ? '0.0' : '1.0'}`,
      `${ind(lvl + 1)}${hi} := ${bound(node.to)}`,
      `${ind(lvl + 1)}for ${k} := ${bound(node.from)}; ${k} <= ${hi}; ${k}++ {`,
      `${ind(lvl + 2)}${acc} ${isSum ? '+=' : '*='} ${body}`,
      `${ind(lvl + 1)}}`,
      `${ind(lvl + 1)}return ${acc}`,
      `${ind(lvl)}}()`,
    ].join('\n');
    return { s, p: PREC.ATOM };
  }

  function emitPiecewise(node: PiecewiseNode, lvl: number): Emitted {
    const lines = ['func() float64 {'];
    for (const c of node.cases) {
      lines.push(`${ind(lvl + 1)}if ${emit(c.cond, lvl + 1).s} {`);
      lines.push(`${ind(lvl + 2)}return ${emit(c.value, lvl + 2).s}`);
      lines.push(`${ind(lvl + 1)}}`);
    }
    const other = node.otherwise ? emit(node.otherwise, lvl + 1).s : `${M('NaN')}()`;
    lines.push(`${ind(lvl + 1)}return ${other}`, `${ind(lvl)}}()`);
    return { s: lines.join('\n'), p: PREC.ATOM };
  }

  const fname = name(def.name);
  const params = def.params.map(name);
  const body = emit(def.body, 1).s;
  const sig = params.length ? `${params.join(', ')} float64` : '';
  return [
    usesMath ? 'import "math"\n\n' : '',
    `// ${docComment(fname, params)}\n`,
    `func ${fname}(${sig}) float64 {\n`,
    `${ind(1)}return ${body}\n`,
    '}',
  ].join('');
}
