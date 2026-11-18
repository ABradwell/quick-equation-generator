import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../public/lib/generators/go.js';
import { parseEquation } from '../../public/lib/parser.js';
import { loadFixtures, close, parseOutput } from '../helpers/fixtures.js';
import { run, toolAvailable, scratchDir } from '../helpers/run.js';

const lit = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

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
    });
    assert.match(out, /func f\(math_ float64\)/);
    assert.match(out, /math\.Sin\(math_\)/);
  });

  const available = toolAvailable('go', ['version']);
  test(
    'generated code matches the reference evaluator',
    { skip: !available && 'go not installed' },
    () => {
      const fixtures = loadFixtures();
      const funcs = [];
      const calls = [];
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
