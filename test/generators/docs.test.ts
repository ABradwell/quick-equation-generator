import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation } from '../../src/lib/parser.ts';
import { LANGUAGES, type LanguageId } from '../../src/lib/generators/index.ts';
import type { GenMeta } from '../../src/lib/generators/shared.ts';

const SRC = 'v(v_0, a, t) = v_0 + a t';
const META: GenMeta = {
  source: SRC,
  title: 'Velocity after constant acceleration',
  about: 'Speed after accelerating uniformly for a time.',
  vars: { v_0: 'initial velocity (m/s)', a: 'acceleration (m/s²)', t: 'time (s)' },
  example: { v_0: 10, a: 9.81, t: 2 },
  expect: 29.62,
  exampleNote: 'a falling object',
};

const PARAM: Record<LanguageId, (name: string, desc: string) => string> = {
  python: (n, d) => `${n}: ${d}`,
  typescript: (n, d) => `@param ${n} ${d}`,
  go: (n, d) => `${n}: ${d}`,
  rust: (n, d) => `${n}: ${d}`,
  java: (n, d) => `@param ${n} ${d}`,
};

for (const [id, lang] of Object.entries(LANGUAGES) as [
  LanguageId,
  (typeof LANGUAGES)[LanguageId],
][]) {
  test(`${id}: notebook metadata becomes the doc comment`, () => {
    const code = lang.generate(parseEquation(SRC), META);
    for (const part of [
      'Velocity after constant acceleration',
      'Speed after accelerating uniformly for a time.',
      `Equation: ${SRC}`,
      PARAM[id]('v_0', 'initial velocity (m/s)'),
      PARAM[id]('t', 'time (s)'),
      'Example: v(10, 9.81, 2) ≈ 29.62 (a falling object)',
    ]) {
      assert.ok(code.includes(part), `missing "${part}" in\n${code}`);
    }
    assert.ok(!code.includes('Evaluate v('));
  });

  test(`${id}: source alone adds only the equation`, () => {
    const code = lang.generate(parseEquation(SRC), { source: SRC });
    assert.ok(code.includes(`Equation: ${SRC}`));
    assert.ok(!code.includes('Example:'));
    assert.ok(!code.includes('initial velocity'));
  });

  test(`${id}: backslashes and comment terminators are safe`, () => {
    const source = 'f(x) = \\frac{x}{2} */ """ \\';
    const code = lang.generate(parseEquation('f(x) = x/2'), {
      ...META,
      source,
      title: 'Tricky */ title',
      about: 'Ends with a backslash \\',
      vars: { x: 'value */ with """ quotes' },
      example: { x: 1 },
      expect: 0.5,
    });
    assert.ok(code.includes('\\frac{x}{2}'), 'LaTeX is kept verbatim');
    if (id === 'python') {
      assert.ok(code.includes('r"""'), 'raw docstring');
      // Only the opening and closing delimiters remain, and the closing one is not escaped.
      assert.equal(code.match(/"""/g)?.length, 2);
      assert.ok(!/\\\s*\n\s*"""/.test(code), 'no trailing backslash before the closing quotes');
    } else if (id === 'typescript' || id === 'java') {
      assert.equal(code.match(/\*\//g)?.length, 1, 'only the real comment end');
    } else {
      // Line comments cannot be terminated by the text; every comment line stays a comment.
      const marker = id === 'go' ? '//' : '///';
      const head = code.split('\n').filter((l) => !l.startsWith(marker));
      assert.ok(head[0].startsWith(id === 'go' ? 'func' : 'fn'), head[0]);
    }
  });
}
