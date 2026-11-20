import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation } from '../../src/lib/parser.ts';
import { evaluate } from '../../src/lib/evaluate.ts';
import { LANGUAGES, type LanguageId } from '../../src/lib/generators/index.ts';
import type { GenMeta } from '../../src/lib/generators/shared.ts';

const IDS = Object.keys(LANGUAGES) as LanguageId[];
const gen = (id: LanguageId, src: string, meta?: GenMeta): string =>
  String(LANGUAGES[id].generate(parseEquation(src), meta));

const GRAVITY = String.raw`F(m_1, m_2, r) = 6.674 \cdot 10^{-11} \frac{m_1 m_2}{r^2}`;
const G_META: GenMeta = {
  constants: { G: { value: 6.674e-11, about: 'gravitational constant, m³/(kg·s²)' } },
};

for (const id of IDS) {
  test(`${id}: folds m * 10^n into one literal`, () => {
    const code = gen(id, GRAVITY);
    assert.ok(code.includes('6.674e-11'), code);
    assert.ok(!/10(\.0)?/.test(code), code);
    const neg = gen(id, String.raw`f(x) = -6.674 \cdot 10^{-11} x`);
    assert.ok(neg.includes('6.674e-11'), neg);
    assert.ok(!neg.includes('--'), neg);
    const chain = gen(id, String.raw`f(x) = 2 \cdot 6.674 \cdot 10^{-11} x`);
    assert.ok(chain.includes('6.674e-11'), chain);
  });

  test(`${id}: does not fold a non-integer exponent or a non-literal`, () => {
    const frac = gen(id, String.raw`f(x) = 6.674 \cdot 10^{-1.5} x`);
    assert.ok(!frac.includes('e-'), frac);
    const sym = gen(id, String.raw`f(x, n) = 6.674 \cdot 10^{n} x`);
    assert.ok(!sym.includes('6.674e'), sym);
    const base = gen(id, String.raw`f(x) = 6.674 \cdot 2^{3} x`);
    assert.ok(!base.includes('6.674e'), base);
  });

  test(`${id}: declared constants are named and commented`, () => {
    const code = gen(id, GRAVITY, G_META);
    const decl = {
      python: 'G = 6.674e-11  # gravitational constant, m³/(kg·s²)',
      typescript: 'const G = 6.674e-11; // gravitational constant, m³/(kg·s²)',
      go: 'const G = 6.674e-11 // gravitational constant, m³/(kg·s²)',
      rust: 'const G: f64 = 6.674e-11; // gravitational constant, m³/(kg·s²)',
      java: 'static final double G = 6.674e-11; // gravitational constant, m³/(kg·s²)',
    }[id];
    assert.ok(code.includes(decl), code);
    assert.ok(code.indexOf(decl) < code.search(/def F|function F|func F|fn F|double F/), code);
    // The literal appears once, in the declaration.
    assert.equal(code.split('6.674e-11').length - 1, 1, code);
    assert.ok(/\bG \* /.test(code), code);
  });

  test(`${id}: a constant that the function does not use is not declared`, () => {
    const code = gen(id, 'f(x) = x + 1', G_META);
    assert.ok(!code.includes('6.674e-11'), code);
  });

  test(`${id}: a constant whose name clashes is left as a literal`, () => {
    // Parameter, function name and loop index.
    for (const src of [
      String.raw`F(G, r) = 6.674 \cdot 10^{-11} \frac{G}{r^2}`,
      String.raw`G(r) = 6.674 \cdot 10^{-11} \frac{1}{r^2}`,
      String.raw`F(r) = \sum_{G=1}^{3} 6.674 \cdot 10^{-11} G r`,
    ]) {
      const code = gen(id, src, G_META);
      assert.ok(code.includes('6.674e-11'), code);
      assert.ok(!/(const|static final double|^)\s*G\b[^=\n]*=\s*6\.674e-11/m.test(code), code);
    }
  });

  test(`${id}: reserved words are never used as constant names`, () => {
    const word = { python: 'lambda', typescript: 'class', go: 'func', rust: 'fn', java: 'final' }[
      id
    ];
    const meta: GenMeta = { constants: { [word]: { value: 6.674e-11, about: 'reserved-test' } } };
    const code = gen(id, GRAVITY, meta);
    assert.ok(!code.includes('reserved-test'), code);
    assert.ok(code.includes('6.674e-11'), code);
  });
}

test('the evaluator reads m * 10^n the same way the generators do', () => {
  const def = parseEquation(String.raw`f(x) = 2 \cdot 6.674 \cdot 10^{-11} x`);
  assert.equal(evaluate(def.body, { x: 3 }), 2 * 6.674e-11 * 3);
  const neg = parseEquation(String.raw`f(x) = -6.674 \cdot 10^{-11} x`);
  assert.equal(evaluate(neg.body, { x: 1 }), -6.674e-11);
  // Not scientific notation: the exponent is not an integer literal.
  const frac = parseEquation(String.raw`f(x) = 6.674 \cdot 10^{-1.5}`);
  assert.equal(evaluate(frac.body, {}), 6.674 * Math.pow(10, -1.5));
});
