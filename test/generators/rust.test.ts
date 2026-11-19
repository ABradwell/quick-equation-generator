import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../src/lib/generators/rust.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import { loadFixtures, close, parseOutput } from '../helpers/fixtures.ts';
import { run, toolAvailable, scratchDir } from '../helpers/run.ts';

const lit = (v: number): string => (Number.isInteger(v) ? `${v}.0` : String(v));

describe('rust generator', () => {
  test('simple output shape', () => {
    const out = generate(parseEquation('f(x) = x^2 + 1/2'));
    assert.match(out, /fn f\(x: f64\) -> f64 \{\n {4}x\.powi\(2\) \+ 1\.0 \/ 2\.0\n\}$/);
  });

  test('method receivers are parenthesized and typed', () => {
    assert.match(generate(parseEquation('f(x) = sqrt(x + 1)')), /\(x \+ 1\.0\)\.sqrt\(\)/);
    assert.match(generate(parseEquation('f(x) = sqrt(2) x')), /2\.0_f64\.sqrt\(\)/);
    assert.match(generate(parseEquation('f(x) = -x^2')), /-x\.powi\(2\)/);
  });

  test('non-integer exponents use powf', () => {
    assert.match(generate(parseEquation('f(x) = x^0.5')), /x\.powf\(0\.5\)/);
  });

  test('reserved words are renamed', () => {
    const out = generate(parseEquation('fn(type, func) = type^2 + \\sum_{k=0}^{3} func k'));
    assert.match(out, /fn fn_\(type_: f64, func: f64\)/);
    assert.match(generate(parseEquation('match(loop) = loop')), /fn match_\(loop_: f64\)/);
  });

  const available = toolAvailable('rustc');
  test(
    'generated code matches the reference evaluator',
    { skip: !available && 'rustc not installed' },
    () => {
      const fixtures = loadFixtures();
      const funcs: string[] = [];
      const calls: string[] = [];
      for (const { id, def, cases } of fixtures) {
        funcs.push(generate({ ...def, name: `${def.name}_${id}` }));
        cases.forEach(({ args }, i) => {
          const v = `${def.name}_${id}(${args.map(lit).join(', ')})`;
          calls.push(`    println!("${id} ${i} {:?}", ${v});`);
        });
      }
      const src = [...funcs, `fn main() {\n${calls.join('\n')}\n}`].join('\n\n');
      const dir = scratchDir('rust');
      writeFileSync(join(dir, 'main.rs'), src);
      run('rustc', ['-O', '-D', 'warnings', '--edition', '2021', 'main.rs', '-o', 'harness'], {
        cwd: dir,
      });
      const results = parseOutput(run(join(dir, 'harness'), [], { cwd: dir }));
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
