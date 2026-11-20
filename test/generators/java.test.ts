import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../src/lib/generators/java.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { close, parseOutput } from '../helpers/fixtures.ts';
import { allFixtures } from './cases.ts';
import { run, toolAvailable, scratchDir } from '../helpers/run.ts';

const lit = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

describe('java generator', () => {
  test('simple output shape', () => {
    const out = generate(parseEquation('f(x) = x^2 + 1/2'));
    assert.match(out, /^\/\/ .*class/);
    assert.match(
      out,
      /public static double f\(double x\) \{\n {4}return Math\.pow\(x, 2\.0\) \+ 1\.0 \/ 2\.0;\n\}$/,
    );
  });

  test('reserved words are renamed', () => {
    const out = generate(parseEquation('def(lambda, int) = lambda int'));
    assert.match(out, /double lambda, double int_\)/);
    assert.match(generate(parseEquation('new(x) = x')), /double new_\(double x\)/);
  });

  test('sum index colliding with a parameter or outer index is renamed', () => {
    const out = generate(parseEquation('f(k) = \\sum_{k=1}^{3} k'));
    assert.match(out, /for \(double k_ = /);
    const nested = generate(parseEquation('g(x) = \\sum_{i=1}^{3} \\sum_{i=1}^{2} i'));
    assert.match(nested, /double i_ = /);
  });

  test('inverse hyperbolics are inlined', () => {
    const out = generate(parseEquation('f(x) = asinh(x) + acosh(x) + atanh(x)'));
    assert.doesNotMatch(out, /Math\.a(sinh|cosh|tanh)/);
  });

  /** The generated method body, between the signature and the closing brace. */
  const body = (src: string): string => {
    const code = generate(parseEquation(src));
    const start = code.indexOf('{\n', code.indexOf('public static')) + 2;
    return code.slice(start, code.lastIndexOf('\n}'));
  };
  const lines = (...l: string[]): string => l.join('\n');

  test('a sum becomes statements before the return', () => {
    assert.equal(
      body('f(x, n) = \\sum_{k=0}^{n} \\frac{x^k}{k+1}'),
      lines(
        '    double sum = 0.0;',
        '    double hi = Math.floor(n + 0.5);',
        '    for (double k = 0.0; k <= hi; k++) {',
        '        sum += Math.pow(x, k) / (k + 1.0);',
        '    }',
        '    return sum;',
      ),
    );
  });

  test('a nested sum is emitted inside the outer loop body', () => {
    assert.equal(
      body('g(x) = \\sum_{i=1}^{3} \\sum_{j=1}^{i} j x'),
      lines(
        '    double sum = 0.0;',
        '    for (double i = 1.0; i <= 3.0; i++) {',
        '        double sum1 = 0.0;',
        '        double hi = Math.floor(i + 0.5);',
        '        for (double j = 1.0; j <= hi; j++) {',
        '            sum1 += j * x;',
        '        }',
        '        sum += sum1;',
        '    }',
        '    return sum;',
      ),
    );
  });

  test('a loop in a bound runs before the loop that uses it', () => {
    assert.equal(
      body('h(n) = \\sum_{k=0}^{\\sum_{j=1}^{n} j} k'),
      lines(
        '    double sum = 0.0;',
        '    double hi = Math.floor(n + 0.5);',
        '    for (double j = 1.0; j <= hi; j++) {',
        '        sum += j;',
        '    }',
        '    double sum1 = 0.0;',
        '    double hi1 = Math.floor(sum + 0.5);',
        '    for (double k = 0.0; k <= hi1; k++) {',
        '        sum1 += k;',
        '    }',
        '    return sum1;',
      ),
    );
  });

  test('sibling loops and products get their own accumulators', () => {
    assert.equal(
      body('p(x) = \\prod_{k=1}^{4} (x - k) + \\sum_{k=1}^{3} k'),
      lines(
        '    double prod = 1.0;',
        '    for (double k = 1.0; k <= 4.0; k++) {',
        '        prod *= x - k;',
        '    }',
        '    double sum = 0.0;',
        '    for (double k = 1.0; k <= 3.0; k++) {',
        '        sum += k;',
        '    }',
        '    return prod + sum;',
      ),
    );
  });

  test('a loop under a piecewise only runs when its branch is taken', () => {
    assert.equal(
      body('q(x) = {x > 0: \\sum_{k=1}^{2} k x, 0}'),
      lines(
        '    return x > 0.0 ? ((java.util.function.DoubleSupplier) () -> {',
        '        double sum = 0.0;',
        '        for (double k = 1.0; k <= 2.0; k++) {',
        '            sum += k * x;',
        '        }',
        '        return sum;',
        '    }).getAsDouble() : 0.0;',
      ),
    );
    // The lambda captures the outer index, so the counter is copied into a final local.
    assert.match(
      body('t(x) = \\sum_{k=1}^{3} {k > 1: \\sum_{j=1}^{k} j x, 0}'),
      /for \(double i = 1\.0; i <= 3\.0; i\+\+\) \{\n {8}double k = i;/,
    );
  });

  const available = toolAvailable('javac', ['-version']) && toolAvailable('java', ['-version']);
  test(
    'generated code matches the reference evaluator',
    { skip: !available && 'java not installed' },
    () => {
      const fixtures = allFixtures();
      const methods = [];
      const calls: string[] = [];
      for (const { id, def, cases } of fixtures) {
        methods.push(generate({ ...def, name: `${def.name}_${id}` }).replace(/^/gm, '    '));
        cases.forEach(({ args }, i) => {
          const v = `${def.name}_${id}(${args.map(lit).join(', ')})`;
          calls.push(`        System.out.println("${id} ${i} " + Double.toString(${v}));`);
        });
      }
      const src = `public class Harness {\n${methods.join('\n\n')}\n\n    public static void main(String[] args) {\n${calls.join('\n')}\n    }\n}\n`;
      const dir = scratchDir('java');
      writeFileSync(join(dir, 'Harness.java'), src);
      run('javac', ['Harness.java'], { cwd: dir });
      const results = parseOutput(run('java', ['-cp', dir, 'Harness'], { cwd: dir }));
      for (const { id, src: eq, cases } of fixtures) {
        cases.forEach(({ args, expected }, i) => {
          const actual = results.get(`${id}:${i}`);
          assert.ok(
            close(actual, expected),
            `${eq} at (${args}): got ${actual}, expected ${expected}`,
          );
        });
      }
    },
  );
});
