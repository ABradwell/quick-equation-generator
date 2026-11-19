// Reference evaluator for the AST (docs/AST.md). Used for the graph and as the
// source of truth when testing generated code in other languages.
import type { ConstantName, Env, Node } from './ast.ts';

const CONSTANTS: Record<ConstantName, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
};

/** Integer loop bounds: floor(x + 0.5). */
export const roundBound = (x: number): number => Math.floor(x + 0.5);

/** Evaluate an expression. Conditions (cmp/and) only appear inside piecewise cases. */
export function evaluate(node: Node, env: Env = {}): number {
  return evalNode(node, env) as number;
}

function evalNode(node: Node, env: Env): number | boolean {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'const':
      return CONSTANTS[node.name];
    case 'var':
      if (!(node.name in env)) throw new Error(`No value for ${node.name}`);
      return env[node.name];
    case 'neg':
      return -evaluate(node.arg, env);
    case 'bin': {
      const a = evaluate(node.left, env);
      const b = evaluate(node.right, env);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return Math.pow(a, b);
        default:
          throw new Error(`Unknown operator ${(node as { op: string }).op}`);
      }
    }
    case 'call':
      return FUNCTIONS[node.fn](...node.args.map((a) => evaluate(a, env)));
    case 'sum':
    case 'prod': {
      const lo = roundBound(evaluate(node.from, env));
      const hi = roundBound(evaluate(node.to, env));
      let acc = node.type === 'sum' ? 0 : 1;
      for (let k = lo; k <= hi; k++) {
        const v = evaluate(node.body, { ...env, [node.index]: k });
        acc = node.type === 'sum' ? acc + v : acc * v;
      }
      return acc;
    }
    case 'piecewise': {
      for (const c of node.cases) {
        if (evalNode(c.cond, env)) return evaluate(c.value, env);
      }
      return node.otherwise ? evaluate(node.otherwise, env) : NaN;
    }
    case 'cmp': {
      const a = evaluate(node.left, env);
      const b = evaluate(node.right, env);
      switch (node.op) {
        case '<':
          return a < b;
        case '>':
          return a > b;
        case '<=':
          return a <= b;
        case '>=':
          return a >= b;
        case '==':
          return a === b;
        default:
          throw new Error(`Unknown comparison ${(node as { op: string }).op}`);
      }
    }
    case 'and':
      return node.args.every((a) => evalNode(a, env));
    default:
      throw new Error(`Unknown node ${(node as { type: string }).type}`);
  }
}
