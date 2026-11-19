import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { close, parseOutput } from '../helpers/fixtures.ts';
import { run, scratchDir, toolAvailable } from '../helpers/run.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { generate } from '../../src/lib/generators/python.ts';
import { allFixtures } from './cases.ts';

const HAVE_PYTHON = toolAvailable('python3', ['--version']);

// Python float literal for a finite number ("3" -> "3.0").
const pyFloat = (v: number): string => {
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

const HARNESS_HEADER = `import math
import sys


def _emit(key, fn, *args):
    try:
        print(key, repr(float(fn(*args))))
    except Exception as exc:  # Python raises where the reference gives inf/NaN
        print(type(exc).__name__, file=sys.stderr)
`;

test(
  'python: generated functions match the reference evaluator',
  { skip: !HAVE_PYTHON && 'python3 not installed' },
  () => {
    const fixtures = allFixtures();
    const defs = [];
    const calls: string[] = [];
    for (const fx of fixtures) {
      const name = `${fx.def.name}_${fx.id}`;
      // Keep one "import math" at the top of the harness, not one per function.
      defs.push(generate({ ...fx.def, name }).replace(/^import math\n+/, ''));
      fx.cases.forEach((c, ci) => {
        const args = c.args
          .map(pyFloat)
          .map((a) => `, ${a}`)
          .join('');
        calls.push(`_emit("${fx.id} ${ci}", ${name}${args})`);
      });
    }

    const dir = scratchDir('python-generators');
    const file = join(dir, 'harness.py');
    writeFileSync(file, [HARNESS_HEADER, ...defs, ...calls, ''].join('\n'));
    const results = parseOutput(run('python3', ['-I', file], { cwd: dir }));

    for (const fx of fixtures) {
      fx.cases.forEach((c, ci) => {
        const key = `${fx.id}:${ci}`;
        if (!results.has(key)) {
          // Python raises (1/0, log(0), sqrt(-1), overflow) where the reference gives inf/NaN.
          // Only those non-finite expectations may go unchecked.
          assert.ok(
            !Number.isFinite(c.expected),
            `${fx.src} args=[${c.args}]: no output, expected ${c.expected}`,
          );
          return;
        }
        const actual = results.get(key);
        assert.ok(
          close(actual, c.expected),
          `${fx.src} args=[${c.args}]: got ${actual}, expected ${c.expected}`,
        );
      });
    }
  },
);

test('python: power, negation and precedence', () => {
  const gen = (src: string): string => generate(parseEquation(src));
  assert.match(gen('y = -x^2'), /^    return -x \*\* 2$/m);
  assert.match(gen('y = (-x)^2'), /^    return \(-x\) \*\* 2$/m);
  assert.match(gen('y = 2^3^2'), /^    return 2 \*\* 3 \*\* 2$/m);
  assert.match(gen('y = (2^3)^2'), /^    return \(2 \*\* 3\) \*\* 2$/m);
  assert.match(gen('y = 8 / (4 / 2)'), /^    return 8 \/ \(4 \/ 2\)$/m);
  assert.match(gen('y = 2^-x'), /^    return 2 \*\* -x$/m);
});

test('python: keyword and builtin names are renamed', () => {
  const code = generate(parseEquation('def(lambda, sum) = lambda sum'));
  assert.match(code, /^def def_\(lambda_: float, sum_: float\) -> float:$/m);
  assert.match(code, /^    return lambda_ \* sum_$/m);
  assert.ok(!code.includes('import math'));
});

test('python: piecewise and sum/prod use conditional expressions and loops', () => {
  const gen = (src: string): string => generate(parseEquation(src));
  assert.match(
    gen('p(x) = {x<0: -x, x<2: x^2, 1}'),
    /^    return \(-x if x < 0 else x \*\* 2 if x < 2 else 1\)$/m,
  );
  assert.match(gen('q(x) = {0<x<1: 1}'), /return \(1 if 0 < x and x < 1 else math\.nan\)/);
  assert.match(
    gen('y = \\sum_{n=1}^{10} n^2'),
    /return sum\(n \*\* 2 for n in map\(float, range\(1, 11\)\)\)/,
  );
  assert.match(
    gen('y = \\prod_{k=1}^{n} k'),
    /return math\.prod\(k for k in map\(float, range\(1, math\.floor\(n \+ 0\.5\) \+ 1\)\)\)/,
  );
});

test('python: imports math only when it is used', () => {
  assert.ok(generate(parseEquation('y = x^2 + 1')).startsWith('def y(x: float) -> float:'));
  assert.ok(generate(parseEquation('y = sin x')).startsWith('import math\n\n\ndef y('));
});
