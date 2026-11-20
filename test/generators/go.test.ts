import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../src/lib/generators/go.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { close, parseOutput } from '../helpers/fixtures.ts';
import { allFixtures } from './cases.ts';
import { run, toolAvailable, scratchDir } from '../helpers/run.ts';

const lit = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

describe('go generator', () => {
  test('simple output shape', () => {
    const out = generate(parseEquation('f(x) = x^2 + 1/2'));
    assert.match(out, /^import "math"\n/);
    assert.match(
      out,
      /func f\(x float64\) float64 \{\n\treturn math\.Pow\(x, 2\.0\) \+ 1\.0 \/ 2\.0\n\}$/,
    );
  });

  test('no import when math is unused', () => {
    assert.doesNotMatch(generate(parseEquation('f(x) = 2x + 1')), /import/);
  });

  test('reserved words are renamed', () => {
    const out = generate(parseEquation('fn(type, func) = type^2 + \\sum_{k=0}^{3} func k'));
    assert.match(out, /func fn\(type_, func_ float64\)/);
    assert.doesNotMatch(out, /\btype\b[^_]/);
    assert.match(generate(parseEquation('func(x) = x')), /func func_\(x float64\)/);
  });

  test('a param named math does not shadow the package', () => {
    const out = generate({
      name: 'f',
      params: ['math'],
      body: { type: 'call', fn: 'sin', args: [{ type: 'var', name: 'math' }] },
      kind: 'function',
      warnings: [],
    });
    assert.match(out, /func f\(math_ float64\)/);
    assert.match(out, /math\.Sin\(math_\)/);
  });

  /** The generated function body, between the signature and the closing brace. */
  const body = (src: string): string => {
    const code = generate(parseEquation(src));
    const start = code.indexOf('{\n', code.indexOf('\nfunc ')) + 2;
    return code.slice(start, code.lastIndexOf('\n}'));
  };
  const lines = (...l: string[]): string => l.join('\n');

  test('a sum becomes statements before the return', () => {
    assert.equal(
      body('f(x, n) = \\sum_{k=0}^{n} \\frac{x^k}{k+1}'),
      lines(
        '\tsum := 0.0',
        '\thi := math.Floor(n + 0.5)',
        '\tfor k := 0.0; k <= hi; k++ {',
        '\t\tsum += math.Pow(x, k) / (k + 1.0)',
        '\t}',
        '\treturn sum',
      ),
    );
  });

  test('a nested sum is emitted inside the outer loop body', () => {
    assert.equal(
      body('g(x) = \\sum_{i=1}^{3} \\sum_{j=1}^{i} j x'),
      lines(
        '\tsum := 0.0',
        '\tfor i := 1.0; i <= 3.0; i++ {',
        '\t\tsum1 := 0.0',
        '\t\thi := math.Floor(i + 0.5)',
        '\t\tfor j := 1.0; j <= hi; j++ {',
        '\t\t\tsum1 += j * x',
        '\t\t}',
        '\t\tsum += sum1',
        '\t}',
        '\treturn sum',
      ),
    );
  });

  test('a loop in a bound runs before the loop that uses it', () => {
    assert.equal(
      body('h(n) = \\sum_{k=0}^{\\sum_{j=1}^{n} j} k'),
      lines(
        '\tsum := 0.0',
        '\thi := math.Floor(n + 0.5)',
        '\tfor j := 1.0; j <= hi; j++ {',
        '\t\tsum += j',
        '\t}',
        '\tsum1 := 0.0',
        '\thi1 := math.Floor(sum + 0.5)',
        '\tfor k := 0.0; k <= hi1; k++ {',
        '\t\tsum1 += k',
        '\t}',
        '\treturn sum1',
      ),
    );
  });

  test('sibling loops and products get their own accumulators', () => {
    assert.equal(
      body('p(x) = \\prod_{k=1}^{4} (x - k) + \\sum_{k=1}^{3} k'),
      lines(
        '\tprod := 1.0',
        '\tfor k := 1.0; k <= 4.0; k++ {',
        '\t\tprod *= x - k',
        '\t}',
        '\tsum := 0.0',
        '\tfor k := 1.0; k <= 3.0; k++ {',
        '\t\tsum += k',
        '\t}',
        '\treturn prod + sum',
      ),
    );
  });

  test('a loop under a piecewise only runs when its branch is taken', () => {
    assert.equal(
      body('q(x) = {x > 0: \\sum_{k=1}^{2} k x, 0}'),
      lines(
        '\treturn func() float64 {',
        '\t\tif x > 0.0 {',
        '\t\t\tsum := 0.0',
        '\t\t\tfor k := 1.0; k <= 2.0; k++ {',
        '\t\t\t\tsum += k * x',
        '\t\t\t}',
        '\t\t\treturn sum',
        '\t\t}',
        '\t\treturn 0.0',
        '\t}()',
      ),
    );
  });

  const available = toolAvailable('go', ['version']);
  test(
    'generated code matches the reference evaluator',
    { skip: !available && 'go not installed' },
    () => {
      const fixtures = allFixtures();
      const funcs: string[] = [];
      const calls: string[] = [];
      for (const { id, def, cases } of fixtures) {
        funcs.push(
          generate({ ...def, name: `${def.name}_${id}` }).replace(/^import "math"\n\n?/, ''),
        );
        cases.forEach(({ args }, i) => {
          const v = `${def.name}_${id}(${args.map(lit).join(', ')})`;
          calls.push(`\tfmt.Println("${id} ${i}", strconv.FormatFloat(${v}, 'g', -1, 64))`);
        });
      }
      const src = [
        'package main',
        'import (\n\t"fmt"\n\t"math"\n\t"strconv"\n)',
        'var _ = math.Pi',
        ...funcs,
        `func main() {\n${calls.join('\n')}\n}`,
      ].join('\n\n');
      const dir = scratchDir('go');
      writeFileSync(join(dir, 'main.go'), src);
      writeFileSync(join(dir, 'go.mod'), 'module harness\n\ngo 1.21\n');
      const results = parseOutput(run('go', ['run', '.'], { cwd: dir }));
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
