// Equations every generator must handle, with inputs to evaluate them at.
// Expected values come from the reference evaluator (src/lib/evaluate.ts).
import { parseEquation } from '../../src/lib/parser.ts';
import { evaluate } from '../../src/lib/evaluate.ts';
import type { Definition } from '../../src/lib/ast.ts';

export interface FixtureSource {
  src: string;
  inputs: number[][];
}

export interface FixtureCase {
  args: number[];
  expected: number;
}

export interface Fixture {
  id: number;
  src: string;
  def: Definition;
  cases: FixtureCase[];
}

export const FIXTURES: FixtureSource[] = [
  { src: 'f(x) = x^2 + 2x + 1', inputs: [[3], [-1.5]] },
  { src: 'y = 2sin x cos x', inputs: [[1], [0.3]] },
  { src: '\\frac{1}{2}mv^2', inputs: [[2, 3]] },
  { src: 'g(t) = e^{-t^2/2}/\\sqrt{2\\pi}', inputs: [[0], [1.2]] },
  { src: '|x-3| + |y|', inputs: [[1, -2]] },
  { src: 'sin^2 x + cos^2 x', inputs: [[0.7]] },
  { src: '\\sum_{n=1}^{10} n^2', inputs: [[]] },
  { src: 'fact(n) = \\prod_{k=1}^{n} k', inputs: [[5], [0]] },
  { src: 'p(x) = {x<0: -x, x<2: x^2, 1}', inputs: [[-3], [1.5], [7]] },
  { src: 'q(x) = {0<x<1: 1}', inputs: [[0.5], [2]] },
  { src: 'h(x) = (x+1)\\cdot\\sqrt[3]{x}', inputs: [[8], [-8]] },
  { src: 'log_2(x) + ln(x) + log(x)', inputs: [[8]] },
  {
    src: 'x^2 + y^2 = 1',
    inputs: [
      [1, 1],
      [0.6, 0.8],
    ],
  },
  { src: 'area(r) = \\pi r^2', inputs: [[2]] },
  {
    src: 'θ = atan2(y, x)',
    inputs: [
      [1, 1],
      [-1, 0.5],
    ],
  },
  { src: 'f(x_1, x_2) = x_1 x_2 + \\lambda', inputs: [[2, 3, 1]] },
  { src: 'fn(type, func) = type^2 + \\sum_{k=0}^{3} func k', inputs: [[2, 0.5]] },
  { src: 'def(lambda, int) = lambda int', inputs: [[2, 3]] },
  { src: 'asin(0.5) + acos(0.5) + atan(1) + sinh(1) + cosh(1) + tanh(1)', inputs: [[]] },
  { src: 'asinh(x) + acosh(x+2) + atanh(x/2)', inputs: [[0.5]] },
  { src: 'sign(x) + floor(x) + ceil(x) + round(x) + abs(x)', inputs: [[-2.5], [0], [3.2]] },
  {
    src: 'mod(a, b)',
    inputs: [
      [7, 3],
      [-7, 3],
    ],
  },
  { src: 'max(a, b, c) - min(a, b, c)', inputs: [[2, 9, -4]] },
  { src: 'x^-2 + 2^x^2 + exp(x) + tau', inputs: [[1.5]] },
  { src: 'S(N, x) = \\sum_{i=1}^{N} \\sum_{j=1}^{i} x^j / i', inputs: [[4, 0.5]] },
  { src: 'k(x) = {x = 0: 1, sin(x)/x}', inputs: [[0], [2]] },
  { src: 'v(x) = -x^2 - (-x)', inputs: [[3]] },
  { src: 'w(x) = \\prod_{k=1}^{3} (x - k) / 2', inputs: [[5]] },
  { src: 'r(x) = 1/x', inputs: [[0]] },
];

/** Parsed fixtures with expected outputs for each input row. */
export function loadFixtures(): Fixture[] {
  return FIXTURES.map((f, id) => {
    const def = parseEquation(f.src);
    const cases = f.inputs.map((args) => {
      if (args.length !== def.params.length) {
        throw new Error(`Fixture ${f.src}: expected ${def.params.length} args`);
      }
      const env = Object.fromEntries(def.params.map((p, i) => [p, args[i]]));
      return { args, expected: evaluate(def.body, env) };
    });
    return { id, src: f.src, def, cases };
  });
}

/** Compare floats; NaN equals NaN, infinities must match exactly. */
export function close(actual: number | undefined, expected: number, tol = 1e-9): boolean {
  if (actual === undefined) return false;
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (!Number.isFinite(expected)) return actual === expected;
  return Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
}

/**
 * Parse harness stdout: one line per case, "<fixtureId> <caseIndex> <value>".
 * Values may be NaN, Inf, +Inf, -Inf, inf, nan, Infinity in any case.
 */
export function parseOutput(stdout: string): Map<string, number> {
  const results = new Map<string, number>();
  for (const line of stdout.trim().split('\n')) {
    const [id, idx, raw] = line.trim().split(/\s+/);
    const v = raw.toLowerCase().replace(/^\+/, '');
    const value =
      v === 'nan'
        ? NaN
        : v === 'inf' || v === 'infinity'
          ? Infinity
          : v === '-inf' || v === '-infinity'
            ? -Infinity
            : Number(raw);
    results.set(`${id}:${idx}`, value);
  }
  return results;
}
