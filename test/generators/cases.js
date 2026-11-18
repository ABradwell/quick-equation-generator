// Generator test cases: the shared fixtures plus extra equations that target precedence,
// associativity, shadowing and loop bounds. Expected values come from the reference evaluator.
import { parseEquation } from '../../public/lib/parser.js';
import { evaluate } from '../../public/lib/evaluate.js';
import { loadFixtures } from '../helpers/fixtures.js';

const EXTRA = [
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
];

/** Every case to generate and run: loadFixtures() plus EXTRA, with unique ids. */
export function allFixtures() {
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
