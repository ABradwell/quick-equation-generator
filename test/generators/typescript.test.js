import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { close, parseOutput } from '../helpers/fixtures.js';
import { run, scratchDir, toolAvailable } from '../helpers/run.js';
import { parseEquation } from '../../public/lib/parser.js';
import { generate } from '../../public/lib/generators/typescript.js';
import { allFixtures } from './cases.js';

const HAVE_TOOLCHAIN = toolAvailable('tsc', ['--version']) && toolAvailable('node', ['--version']);

test(
  'typescript: generated functions match the reference evaluator',
  { skip: !HAVE_TOOLCHAIN && 'tsc not installed' },
  () => {
    const fixtures = allFixtures();
    const parts = [];
    const calls = [];
    for (const fx of fixtures) {
      const name = `${fx.def.name}_${fx.id}`;
      parts.push(generate({ ...fx.def, name }));
      fx.cases.forEach((c, ci) => {
        calls.push(
          `console.log(${JSON.stringify(`${fx.id} ${ci}`)} + " " + String(${name}(${c.args.join(', ')})));`,
        );
      });
    }

    const dir = scratchDir('typescript-generators');
    const file = join(dir, 'harness.ts');
    writeFileSync(file, [...parts, ...calls, ''].join('\n'));
    // Type-check under strict mode, then emit ESM (the project package.json has "type": "module").
    run('tsc', ['--noEmit', '--strict', '--target', 'es2022', file], { cwd: dir });
    run('tsc', ['--strict', '--target', 'es2022', '--outDir', join(dir, 'out'), file], {
      cwd: dir,
    });
    const results = parseOutput(run('node', [join(dir, 'out', 'harness.js')]));

    for (const fx of fixtures) {
      fx.cases.forEach((c, ci) => {
        const key = `${fx.id}:${ci}`;
        const actual = results.get(key);
        assert.ok(
          results.has(key) && close(actual, c.expected),
          `${fx.src} args=[${c.args}]: got ${actual}, expected ${c.expected}`,
        );
      });
    }
  },
);

test('typescript: power, negation and precedence', () => {
  const gen = (src) => generate(parseEquation(src));
  // -x ** 2 is a syntax error in JavaScript, so the operand of the negation is parenthesised.
  assert.match(gen('y = -x^2'), /^    return -\(x \*\* 2\);$/m);
  assert.match(gen('y = (-x)^2'), /^    return \(-x\) \*\* 2;$/m);
  assert.match(gen('y = -(-x)'), /^    return -\(-x\);$/m);
  assert.match(gen('y = 2^-x'), /^    return 2 \*\* -x;$/m);
  assert.match(gen('y = 2^3^2'), /^    return 2 \*\* 3 \*\* 2;$/m);
  assert.match(gen('y = (2^3)^2'), /^    return \(2 \*\* 3\) \*\* 2;$/m);
  assert.match(gen('y = 8 / (4 / 2)'), /^    return 8 \/ \(4 \/ 2\);$/m);
});

test('typescript: reserved words are renamed', () => {
  const code = generate(parseEquation('g(function, class) = function * class'));
  assert.match(code, /^export function g\(function_: number, class_: number\): number \{$/m);
  assert.match(code, /^    return function_ \* class_;$/m);
});

test('typescript: piecewise uses ternaries; sum/prod use a loop with scratch names', () => {
  const gen = (src) => generate(parseEquation(src));
  assert.match(
    gen('p(x) = {x<0: -x, x<2: x^2, 1}'),
    /^    return \(x < 0 \? -x : x < 2 \? x \*\* 2 : 1\);$/m,
  );
  assert.match(gen('q(x) = {0<x<1: 1}'), /return \(0 < x && x < 1 \? 1 : NaN\);/);
  // The accumulator must not capture a parameter named like the accumulator.
  const sum = gen('f(s) = \\sum_{n=1}^{3} n s');
  assert.match(sum, /const _lo = 1, _hi = 3; let _acc = 0; for \(let n = _lo;/);
  assert.match(sum, /_acc \+= n \* s;/);
});
