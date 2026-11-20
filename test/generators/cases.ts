// Generator test cases: the shared fixtures plus extra equations that target precedence,
// associativity, shadowing and loop bounds. Expected values come from the reference evaluator.
import { parseEquation } from '../../src/lib/parser.ts';
import { evaluate } from '../../src/lib/evaluate.ts';
import { loadFixtures } from '../helpers/fixtures.ts';
import type { Fixture, FixtureSource } from '../helpers/fixtures.ts';

const EXTRA: FixtureSource[] = [
  { src: 'a(x) = -x^2', inputs: [[3]] },
  { src: 'b(x) = (-x)^2', inputs: [[3]] },
  { src: 'c(x) = 2^3^2 + (2^3)^2 - x', inputs: [[1]] },
  { src: 'd(x) = 2^-x', inputs: [[2]] },
  { src: 'e2(x) = 10 - 4 - 3 + 8 / 4 / 2 * x', inputs: [[3]] },
  { src: 'f2(x) = 8 / (4 / 2) - 10 - (4 - 3) + x', inputs: [[0]] },
  { src: 'n2(N) = \\sum_{n=0}^{N-1} n', inputs: [[4], [0]] },
  { src: 'nest(x) = \\sum_{n=1}^{3} \\sum_{k=1}^{n} k x', inputs: [[2]] },
  { src: 'sh(s) = \\sum_{n=1}^{3} n s', inputs: [[2]] },
  { src: 'pr(x) = \\prod_{n=1}^{4} n x', inputs: [[1.5]] },
  { src: 'cb(x) = cbrt(x)', inputs: [[-27], [8]] },
  { src: 'pw(x) = {x > 0: x}', inputs: [[1], [-1]] },
  { src: 'ln0(x) = ln(x)', inputs: [[0]] },
  { src: 'big(x) = exp(x)', inputs: [[1000]] },
  { src: 'mm(x) = min(x, 2) + max(x, 2)', inputs: [[5]] },
  { src: 'sg(x) = sign(x)', inputs: [[-4], [0], [2.5]] },
  // Loop shapes: a loop in a bound, sibling loops, an index shadowing a parameter in its own
  // bound, and loops under a piecewise. At x = 0, pwl's first branch has an infinite upper
  // bound (1 / 0), so the loop there must not run unless the branch is taken.
  { src: 'lb(n) = \\sum_{k=0}^{\\sum_{j=1}^{n} j} k', inputs: [[3]] },
  { src: 'sib(x) = \\prod_{k=1}^{4} (x - k) + \\sum_{k=1}^{3} k', inputs: [[1.5]] },
  { src: 'ish(k) = \\sum_{k=k}^{3} k', inputs: [[1]] },
  {
    src: 'pwl(x) = {x > 0: \\sum_{k=1}^{1/x} k, \\sum_{k=1}^{2} k < x: 1, 0}',
    inputs: [[0], [4], [0.5]],
  },
  { src: 'lpw(x) = \\sum_{k=1}^{3} {k > 1: \\sum_{j=1}^{k} j x, 0}', inputs: [[2]] },
];

/** Every case to generate and run: loadFixtures() plus EXTRA, with unique ids. */
export function allFixtures(): Fixture[] {
  const extra = EXTRA.map((f, i) => {
    const def = parseEquation(f.src);
    const cases = f.inputs.map((args) => {
      const env = Object.fromEntries(def.params.map((p, j) => [p, args[j]]));
      return { args, expected: evaluate(def.body, env) };
    });
    return { id: 1000 + i, src: f.src, def, cases };
  });
  return [...loadFixtures(), ...extra];
}
