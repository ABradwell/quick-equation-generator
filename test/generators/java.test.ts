import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../src/lib/generators/java.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { loadFixtures, close, parseOutput } from '../helpers/fixtures.ts';
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

  const available = toolAvailable('javac', ['-version']) && toolAvailable('java', ['-version']);
  test(
    'generated code matches the reference evaluator',
    { skip: !available && 'java not installed' },
    () => {
      const fixtures = loadFixtures();
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
