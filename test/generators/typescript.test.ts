import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { close, parseOutput } from '../helpers/fixtures.ts';
import { run, scratchDir, toolAvailable } from '../helpers/run.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { generate } from '../../src/lib/generators/typescript.ts';
import { allFixtures } from './cases.ts';

const HAVE_TOOLCHAIN = toolAvailable('tsc', ['--version']) && toolAvailable('node', ['--version']);

test(
  'typescript: generated functions match the reference evaluator',
  { skip: !HAVE_TOOLCHAIN && 'tsc not installed' },
  () => {
    const fixtures = allFixtures();
    const parts: string[] = [];
    const calls: string[] = [];
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
    run('tsc', ['--ignoreConfig', '--noEmit', '--strict', '--target', 'es2022', file], {
      cwd: dir,
    });
    run(
      'tsc',
      ['--ignoreConfig', '--strict', '--target', 'es2022', '--outDir', join(dir, 'out'), file],
      {
        cwd: dir,
      },
    );
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
  const gen = (src: string): string => generate(parseEquation(src));
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

test('typescript: piecewise uses ternaries', () => {
  const gen = (src: string): string => generate(parseEquation(src));
  assert.match(
    gen('p(x) = {x<0: -x, x<2: x^2, 1}'),
    /^    return \(x < 0 \? -x : x < 2 \? x \*\* 2 : 1\);$/m,
  );
  assert.match(gen('q(x) = {0<x<1: 1}'), /return \(0 < x && x < 1 \? 1 : NaN\);/);
});

/** The generated function body, between the signature and the closing brace. */
const body = (src: string): string => {
  const code = generate(parseEquation(src));
  return code.slice(code.indexOf('{\n') + 2, code.lastIndexOf('\n}'));
};
const lines = (...l: string[]): string => l.join('\n');

test('typescript: a sum becomes statements before the return', () => {
  assert.equal(
    body('f(x, n) = \\sum_{k=0}^{n} \\frac{x^k}{k+1}'),
    lines(
      '    let sum = 0;',
      '    const hi = Math.floor(n + 0.5);',
      '    for (let k = 0; k <= hi; k++) {',
      '        sum += x ** k / (k + 1);',
      '    }',
      '    return sum;',
    ),
  );
  // Scratch names avoid parameters.
  assert.equal(
    body('f(sum, hi) = \\sum_{n=1}^{hi} n sum'),
    lines(
      '    let sum1 = 0;',
      '    const hi1 = Math.floor(hi + 0.5);',
      '    for (let n = 1; n <= hi1; n++) {',
      '        sum1 += n * sum;',
      '    }',
      '    return sum1;',
    ),
  );
});

test('typescript: a nested sum is emitted inside the outer loop body', () => {
  assert.equal(
    body('g(x) = \\sum_{i=1}^{3} \\sum_{j=1}^{i} j x'),
    lines(
      '    let sum = 0;',
      '    for (let i = 1; i <= 3; i++) {',
      '        let sum1 = 0;',
      '        const hi = Math.floor(i + 0.5);',
      '        for (let j = 1; j <= hi; j++) {',
      '            sum1 += j * x;',
      '        }',
      '        sum += sum1;',
      '    }',
      '    return sum;',
    ),
  );
});

test('typescript: a loop in a bound runs before the loop that uses it', () => {
  assert.equal(
    body('h(n) = \\sum_{k=0}^{\\sum_{j=1}^{n} j} k'),
    lines(
      '    let sum = 0;',
      '    const hi = Math.floor(n + 0.5);',
      '    for (let j = 1; j <= hi; j++) {',
      '        sum += j;',
      '    }',
      '    let sum1 = 0;',
      '    const hi1 = Math.floor(sum + 0.5);',
      '    for (let k = 0; k <= hi1; k++) {',
      '        sum1 += k;',
      '    }',
      '    return sum1;',
    ),
  );
  // `let k = Math.floor(k + 0.5)` would read the new k, so the lower bound gets a name.
  assert.match(
    body('r(k) = \\sum_{k=k}^{3} k'),
    /const lo = Math\.floor\(k \+ 0\.5\);\n.*let k = lo;/,
  );
});

test('typescript: sibling loops and products get their own accumulators', () => {
  assert.equal(
    body('p(x) = \\prod_{k=1}^{4} (x - k) + \\sum_{k=1}^{3} k'),
    lines(
      '    let prod = 1;',
      '    for (let k = 1; k <= 4; k++) {',
      '        prod *= x - k;',
      '    }',
      '    let sum = 0;',
      '    for (let k = 1; k <= 3; k++) {',
      '        sum += k;',
      '    }',
      '    return prod + sum;',
    ),
  );
});

test('typescript: a loop under a piecewise only runs when its branch is taken', () => {
  assert.equal(
    body('q(x) = {x > 0: \\sum_{k=1}^{1/x} k, 0}'),
    lines(
      '    return (x > 0 ? (() => {',
      '        let sum = 0;',
      '        const hi = Math.floor(1 / x + 0.5);',
      '        for (let k = 1; k <= hi; k++) {',
      '            sum += k;',
      '        }',
      '        return sum;',
      '    })() : 0);',
    ),
  );
});
