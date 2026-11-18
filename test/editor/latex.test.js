import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromLatex, toLatex } from '../../public/lib/editor/latex.js';
import {
  blocksOf,
  constAtom,
  fnAtom,
  greekAtom,
  isNode,
  makeAtom,
  makeBigop,
  makeBlock,
  makeFrac,
  makeParen,
  makeScript,
  makeSqrt,
} from '../../public/lib/editor/tree.js';
import { parseEquation } from '../../public/lib/parser.js';
import { close, loadFixtures } from '../helpers/fixtures.js';
import { evaluate } from '../../public/lib/evaluate.js';

const v = (ch) => makeAtom(ch, ch, 'var');
const n = (ch) => makeAtom(ch, ch, 'num');
const op = (ch) => makeAtom(ch, ch, 'op');
const block = (...items) => makeBlock(items);

// ------------------------------------------------------------------- toLatex

test('toLatex: atoms and commands get a space before a following letter', () => {
  assert.equal(toLatex(block(v('x'), op('+'), n('1'))), 'x+1');
  assert.equal(toLatex(block(constAtom('pi'), v('r'))), '\\pi r');
  assert.equal(toLatex(block(n('2'), constAtom('pi'))), '2\\pi');
  assert.equal(toLatex(block(fnAtom('sin'), v('x'))), '\\sin x');
  assert.equal(toLatex(block(fnAtom('sin'), n('2'))), '\\sin2');
  assert.equal(toLatex(block(greekAtom('theta'), greekAtom('alpha'))), '\\theta\\alpha');
  assert.equal(toLatex(block(greekAtom('lambda'), v('i'), v('n'), v('t'))), '\\lambda int');
  assert.equal(toLatex(block(makeAtom('≤', '\\le', 'op'), v('y'))), '\\le y');
  assert.equal(toLatex(block(makeAtom('·', '\\cdot', 'op'), v('y'))), '\\cdot y');
  assert.equal(toLatex(block(makeAtom('·', '\\cdot', 'op'), n('3'))), '\\cdot3');
});

test('toLatex: function names that LaTeX lacks use \\operatorname', () => {
  assert.equal(toLatex(block(fnAtom('arcsin'))), '\\arcsin');
  assert.equal(toLatex(block(fnAtom('asin'))), '\\operatorname{asin}');
  assert.equal(toLatex(block(fnAtom('abs'), v('x'))), '\\operatorname{abs}x');
  assert.equal(toLatex(block(fnAtom('max'))), '\\max');
});

test('toLatex: scripts drop braces only when that is unambiguous', () => {
  const sup = (...items) => makeScript('sup', items);
  const sub = (...items) => makeScript('sub', items);
  assert.equal(toLatex(block(v('x'), sup(n('2')))), 'x^2');
  assert.equal(toLatex(block(v('x'), sup(n('1'), n('0')))), 'x^{10}');
  assert.equal(toLatex(block(v('x'), sup(v('n')))), 'x^n');
  assert.equal(toLatex(block(v('x'), sup(n('2')), op('+'), n('1'))), 'x^2+1');
  assert.equal(toLatex(block(v('x'), sup(n('2')), n('3'))), 'x^{2}3', 'would read as x^23');
  assert.equal(toLatex(block(v('x'), sup(n('2')), v('y'))), 'x^2y');
  assert.equal(toLatex(block(v('x'), sup(v('a')), v('s'))), 'x^{a}s', 'would read as a word');
  assert.equal(toLatex(block(v('x'), sup(op('-'), n('1')))), 'x^{-1}');
  assert.equal(toLatex(block(v('x'), sup(greekAtom('theta')))), 'x^{\\theta}');
  assert.equal(toLatex(block(v('x'), sup())), 'x^{}');
  assert.equal(toLatex(block(v('x'), sub(n('1')))), 'x_1');
  assert.equal(toLatex(block(v('x'), sub(n('1')), sup(n('2')))), 'x_1^2');
  assert.equal(toLatex(block(v('x'), sup(n('2')), sub(n('1')))), 'x_1^2', 'subscript first');
  assert.equal(toLatex(block(v('x'), sub(n('1'), n('2')))), 'x_{12}');
  assert.equal(toLatex(block(v('x'), sup(v('x'), sup(n('2'))))), 'x^{x^2}');
  assert.equal(toLatex(block(fnAtom('sin'), sup(n('2')), v('x'))), '\\sin^2x');
  assert.equal(
    toLatex(block(fnAtom('log'), sub(n('2')), makeParen('(', [v('x')]))),
    '\\log_2\\left(x\\right)',
  );
});

test('toLatex: structures', () => {
  assert.equal(toLatex(block(makeFrac([n('1')], [n('2')]))), '\\frac{1}{2}');
  assert.equal(toLatex(block(makeFrac([], []))), '\\frac{}{}');
  assert.equal(toLatex(block(makeSqrt([v('x')]))), '\\sqrt{x}');
  assert.equal(toLatex(block(makeSqrt([v('x')], [n('3')]))), '\\sqrt[3]{x}');
  assert.equal(toLatex(block(makeParen('(', [v('x')]))), '\\left(x\\right)');
  assert.equal(toLatex(block(makeParen('[', [v('x')]))), '\\left[x\\right]');
  assert.equal(toLatex(block(makeParen('{', [v('x')]))), '\\left\\{x\\right\\}');
  assert.equal(toLatex(block(makeParen('|', [v('x')]))), '\\left|x\\right|');
  assert.equal(
    toLatex(block(makeBigop('sum', [v('n'), op('='), n('1')], [n('1'), n('0')]), v('n'))),
    '\\sum_{n=1}^{10}n',
  );
  assert.equal(toLatex(block(makeBigop('prod', [], []))), '\\prod_{}^{}');
  assert.equal(toLatex(block()), '');
});

test('toLatex accepts an array of items (selections)', () => {
  const b = block(v('a'), v('b'), v('c'));
  assert.equal(toLatex(b.items.slice(1)), 'bc');
});

test('toLatex output is accepted by parseEquation', () => {
  const trees = [
    block(makeFrac([v('a'), op('+'), v('b')], [n('2')])),
    block(fnAtom('sin'), v('x'), makeAtom('·', '\\cdot', 'op'), fnAtom('cos'), v('x')),
    block(makeSqrt([v('x')], [n('3')]), v('y')),
    block(
      makeBigop('sum', [v('k'), op('='), n('1')], [v('n')]),
      v('k'),
      makeScript('sup', [n('2')]),
    ),
    block(
      makeParen('{', [
        v('x'),
        op('<'),
        n('0'),
        makeAtom(':', ':', 'punct'),
        op('-'),
        v('x'),
        makeAtom(',', ',', 'punct'),
        v('x'),
      ]),
    ),
    block(makeParen('|', [v('x'), op('-'), n('3')]), op('+'), makeParen('|', [v('y')])),
    block(v('x'), makeScript('sub', [n('1')]), makeScript('sup', [n('2')])),
    block(makeAtom('≤', '\\le', 'op')),
  ];
  for (const t of trees.slice(0, -1)) {
    const latex = toLatex(t);
    assert.doesNotThrow(() => parseEquation(latex), latex);
  }
  // comparisons are accepted inside a brace group (piecewise condition)
  assert.doesNotThrow(() => parseEquation('{x\\le3:1,2}'));
  assert.doesNotThrow(() => parseEquation('{x\\ge3\\cdot y:1,2}'));
});

// ------------------------------------------------------------------ fromLatex

const roundTrip = (src) => {
  const r = fromLatex(src);
  assert.ok(r.ok, `${src}: ${r.error}`);
  return toLatex(r.root);
};

test('fromLatex accepts everything toLatex emits (idempotent)', () => {
  const samples = [
    '\\frac{1}{2}',
    '\\frac{\\frac{a}{b}}{c}',
    'x^2+1',
    'x^{10}',
    'x_1',
    'x_{12}',
    'x_1^2',
    '\\sqrt{x}',
    '\\sqrt[3]{x}',
    '\\left(x+1\\right)^2',
    '\\left[x\\right]',
    '\\left\\{x<0:-x,x\\right\\}',
    '\\left|x-3\\right|+\\left|y\\right|',
    '\\sum_{n=1}^{10}n^2',
    '\\prod_{k=1}^{n}k',
    '\\sin x\\cos x',
    '\\sin^2x',
    '\\operatorname{asinh}\\left(x\\right)',
    '\\operatorname{atan2}\\left(y,x\\right)',
    '\\theta=\\pi r^2',
    '2\\pi r',
    'x\\le3',
    'x\\ge3',
    'a\\cdot b',
    '\\log_2\\left(x\\right)',
    '\\frac{}{}',
    '\\sqrt{}',
    '\\sum_{}^{}',
    'e^{-\\frac{t^2}{2}}',
    '2^{x^2}',
    'x^{-1}',
  ];
  for (const s of samples) assert.equal(roundTrip(s), s);
});

test('fromLatex: ASCII forms people type', () => {
  assert.equal(roundTrip('x^2'), 'x^2');
  assert.equal(roundTrip('x^{10}'), 'x^{10}');
  assert.equal(roundTrip('x_1'), 'x_1');
  assert.equal(roundTrip('x_12'), 'x_{12}');
  assert.equal(roundTrip('sqrt(x)'), '\\sqrt{x}');
  assert.equal(roundTrip('sqrt(x+1)'), '\\sqrt{x+1}');
  assert.equal(roundTrip('sqrt x'), '\\sqrt{x}');
  assert.equal(roundTrip('sqrt 2x'), '\\sqrt{2x}');
  assert.equal(roundTrip('\\sqrt 2x'), '\\sqrt{2}x');
  assert.equal(roundTrip('√x'), '\\sqrt{x}');
  assert.equal(roundTrip('|x|'), '\\left|x\\right|');
  assert.equal(roundTrip('(x+1)'), '\\left(x+1\\right)');
  assert.equal(roundTrip('[x]'), '\\left[x\\right]');
  assert.equal(roundTrip('{x<0: -x, x}'), '\\left\\{x<0:-x,x\\right\\}');
  assert.equal(roundTrip('\\{x\\}'), '\\left\\{x\\right\\}');
  assert.equal(roundTrip('\\frac{a}{b}'), '\\frac{a}{b}');
  assert.equal(roundTrip('\\dfrac{a}{b}'), '\\frac{a}{b}');
  assert.equal(roundTrip('\\sqrt[3]{x}'), '\\sqrt[3]{x}');
  assert.equal(roundTrip('\\sum_{n=1}^{10}'), '\\sum_{n=1}^{10}');
  assert.equal(roundTrip('sum_(n=1)^{N} n'), '\\sum_{n=1}^{N}n');
  assert.equal(roundTrip('sum_(n=1)^(N) n'), '\\sum_{n=1}^{N}n');
  assert.equal(roundTrip('\\sum_{n=1}^N n'), '\\sum_{n=1}^{N}n');
  assert.equal(roundTrip('prod_{k=1}^{n} k'), '\\prod_{k=1}^{n}k');
  assert.equal(roundTrip('x**2'), 'x^2');
  assert.equal(roundTrip('x^-2'), 'x^{-2}');
  assert.equal(roundTrip('2^x^2'), '2^{x^2}');
  assert.equal(roundTrip('x^(n+1)'), 'x^{\\left(n+1\\right)}');
});

test('fromLatex: names, Greek, constants and operators', () => {
  assert.equal(roundTrip('theta'), '\\theta');
  assert.equal(roundTrip('\\theta'), '\\theta');
  assert.equal(roundTrip('θ'), '\\theta');
  assert.equal(roundTrip('Delta x'), '\\Delta x');
  assert.equal(roundTrip('\\varepsilon'), '\\varepsilon');
  assert.equal(roundTrip('sin x'), '\\sin x');
  assert.equal(roundTrip('\\sin x'), '\\sin x');
  assert.equal(roundTrip('\\operatorname{sin}x'), '\\sin x');
  assert.equal(roundTrip('arcsin(x)'), '\\arcsin\\left(x\\right)');
  assert.equal(roundTrip('sinx'), '\\sin x');
  assert.equal(roundTrip('asin(x)'), '\\operatorname{asin}\\left(x\\right)');
  assert.equal(roundTrip('pi'), '\\pi');
  assert.equal(roundTrip('π'), '\\pi');
  assert.equal(roundTrip('2pi r'), '2\\pi r');
  assert.equal(roundTrip('tau'), '\\tau');
  assert.equal(roundTrip('e^x'), 'e^x');
  assert.equal(roundTrip('x<=3'), 'x\\le3');
  assert.equal(roundTrip('x\\le3'), 'x\\le3');
  assert.equal(roundTrip('x≤3'), 'x\\le3');
  assert.equal(roundTrip('x>=3'), 'x\\ge3');
  assert.equal(roundTrip('x\\geq3'), 'x\\ge3');
  assert.equal(roundTrip('a*b'), 'a\\cdot b');
  assert.equal(roundTrip('a\\cdot b'), 'a\\cdot b');
  assert.equal(roundTrip('a·b'), 'a\\cdot b');
  assert.equal(roundTrip('a\\times b'), 'a\\cdot b');
  assert.equal(roundTrip('a−b'), 'a-b');
  assert.equal(roundTrip('a÷b'), 'a/b');
  assert.equal(roundTrip('\\left( x \\right)'), '\\left(x\\right)');
  assert.equal(roundTrip('x\\,y'), 'xy');
  assert.equal(roundTrip(''), '');
  assert.equal(roundTrip('  '), '');
});

test('fromLatex: plain a/b stays as atoms', () => {
  const r = fromLatex('a/b');
  assert.deepEqual(
    r.root.items.map((i) => i.kind),
    ['atom', 'atom', 'atom'],
  );
  assert.equal(r.root.items[1].latex, '/');
  assert.equal(r.root.items[1].cls, 'op');
});

test('fromLatex: tree shape, classes and parent links', () => {
  const r = fromLatex('\\sum_{n=1}^{10}\\frac{\\sin\\theta}{2}x_1');
  assert.ok(r.ok);
  const [sum, frac, x, sub] = r.root.items;
  assert.equal(sum.kind, 'bigop');
  assert.equal(sum.op, 'sum');
  assert.deepEqual(
    sum.blocks.map((b) => b.items.length),
    [3, 2],
  );
  assert.equal(frac.kind, 'frac');
  assert.deepEqual(
    frac.blocks[0].items.map((a) => a.cls),
    ['fn', 'greek'],
  );
  assert.equal(x.cls, 'var');
  assert.equal(sub.kind, 'sub');
  const check = (b, parent) => {
    assert.equal(b.parent, parent);
    for (const item of b.items) {
      assert.equal(item.parent, b);
      if (isNode(item)) blocksOf(item).forEach((c) => check(c, item));
    }
  };
  check(r.root, null);
  const sq = fromLatex('\\sqrt[3]{x}').root.items[0];
  assert.equal(sq.index.parent, sq);
  assert.equal(sq.index.items[0].text, '3');
  const par = fromLatex('|x|').root.items[0];
  assert.deepEqual([par.kind, par.open, par.close], ['paren', '|', '|']);
  const ids = new Set();
  let count = 0;
  const collect = (b) => {
    ids.add(b.id);
    count++;
    for (const item of b.items) {
      ids.add(item.id);
      count++;
      if (isNode(item)) blocksOf(item).forEach(collect);
    }
  };
  collect(r.root);
  assert.equal(ids.size, count, 'ids are unique');
});

test('fromLatex: absolute values pair by context', () => {
  assert.equal(roundTrip('|x-3| + |y|'), '\\left|x-3\\right|+\\left|y\\right|');
  assert.equal(roundTrip('||x|-1|'), '\\left|\\left|x\\right|-1\\right|');
  assert.equal(roundTrip('|1-|x||'), '\\left|1-\\left|x\\right|\\right|');
  assert.equal(roundTrip('\\left|x\\right|'), '\\left|x\\right|');
  assert.equal(roundTrip('2|x|'), '2\\left|x\\right|');
});

test('fromLatex: failures report ok:false with a message', () => {
  for (const bad of [
    '(x',
    'x)',
    '[x)',
    '\\frac{1}{2',
    '\\frac12',
    'x^',
    'x_',
    '\\foo',
    'x@y',
    '\\left(x',
    '\\left(x\\right]',
    '|x',
    '\\operatorname{foo}(x)',
    '{x',
    'x}',
  ]) {
    const r = fromLatex(bad);
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    assert.equal(typeof r.error, 'string');
    assert.equal(r.root, undefined);
  }
  assert.equal(fromLatex(null).ok, false);
});

test('fromLatex: multi-letter parameter names are not split into words', () => {
  // "tangent" is one variable for the parser here, so it must stay letters in the tree
  const src = 'f(tangent) = tangent^2';
  const r = fromLatex(src);
  assert.ok(r.ok);
  assert.ok(r.root.items.every((i) => i.cls !== 'fn' || i.text !== 'tan'));
  const def = parseEquation(toLatex(r.root));
  assert.deepEqual(def.params, ['tangent']);
});

// ------------------------------------------------- round trip over the fixtures

test('round trip: every fixture evaluates the same after fromLatex -> toLatex', () => {
  for (const fx of loadFixtures()) {
    const imported = fromLatex(fx.src);
    assert.ok(imported.ok, `${fx.src}: ${imported.error}`);
    const latex = toLatex(imported.root);
    let def;
    try {
      def = parseEquation(latex);
    } catch (err) {
      assert.fail(
        `parseEquation rejected ${JSON.stringify(latex)} (from ${fx.src}): ${err.message}`,
      );
    }
    assert.equal(def.name, fx.def.name, fx.src);
    assert.equal(def.kind, fx.def.kind, fx.src);
    assert.deepEqual(def.params, fx.def.params, fx.src);
    for (const c of fx.cases) {
      const env = Object.fromEntries(fx.def.params.map((p, i) => [p, c.args[i]]));
      const got = evaluate(def.body, env);
      assert.ok(
        close(got, c.expected),
        `${fx.src} -> ${latex} at ${c.args}: ${got} vs ${c.expected}`,
      );
    }
    // and it is a fixed point
    assert.equal(roundTrip(latex), latex, fx.src);
  }
});
