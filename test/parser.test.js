import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation, ParseError } from '../public/lib/parser.js';
import { evaluate } from '../public/lib/evaluate.js';

const value = (src, env = {}) => evaluate(parseEquation(src).body, env);

test('function definitions, assignments and bare expressions', () => {
  assert.deepEqual(
    (({ name, params, kind }) => ({ name, params, kind }))(parseEquation('f(x, y) = x + y')),
    { name: 'f', params: ['x', 'y'], kind: 'function' },
  );
  const y = parseEquation('y = 2x + b');
  assert.equal(y.name, 'y');
  assert.deepEqual(y.params, ['x', 'b']);
  assert.equal(parseEquation('x^2 + 1').name, 'f');
  assert.equal(parseEquation('x^2 + y^2 = 1').kind, 'implicit');
});

test('implicit multiplication and precedence', () => {
  assert.equal(value('2x^2', { x: 3 }), 18);
  assert.equal(value('-x^2', { x: 3 }), -9);
  assert.equal(value('2^3^2'), 512);
  assert.equal(value('x(x+1)', { x: 2 }), 6);
  assert.equal(value('1/2x', { x: 4 }), 2);
  assert.equal(value('(1)(2)(3)'), 6);
  assert.equal(value('x^-2', { x: 2 }), 0.25);
});

test('functions with and without parentheses', () => {
  assert.ok(Math.abs(value('2sin x cos x', { x: 1 }) - Math.sin(2)) < 1e-12);
  assert.ok(Math.abs(value('sin^2 x + cos^2 x', { x: 0.4 }) - 1) < 1e-12);
  assert.equal(value('sin^{-1}(1)'), Math.PI / 2);
  assert.equal(value('log_2(8)'), 3);
  assert.equal(value('log(1000)'), 3);
  assert.equal(value('mod(-7, 3)'), 2);
  assert.equal(value('round(2.5)'), 3);
  assert.equal(value('max(1, 5, 3)'), 5);
});

test('LaTeX input', () => {
  assert.equal(value('\\frac{1}{2}mv^2', { m: 2, v: 3 }), 9);
  assert.equal(value('\\sqrt[3]{-8}'), -2);
  assert.equal(value('\\left(x+1\\right)\\cdot 2', { x: 1 }), 4);
  assert.equal(value('\\sum_{n=1}^{10} n'), 55);
  assert.equal(value('\\prod_{k=1}^{5} k'), 120);
  assert.equal(value('\\operatorname{abs}(-3)'), 3);
  assert.equal(parseEquation('\\theta(r) = 2r').name, 'theta');
});

test('Greek letters, subscripts and multi-letter params', () => {
  assert.deepEqual(parseEquation('θ = atan2(y, x)').params, ['x', 'y']);
  assert.deepEqual(parseEquation('x_1 + x_{12} + \\alpha').params, ['alpha', 'x_1', 'x_12']);
  assert.deepEqual(parseEquation('ke(mass, v) = mass v^2 / 2').params, ['mass', 'v']);
});

test('abs bars and piecewise', () => {
  assert.equal(value('|x - 3| + |y|', { x: 1, y: -2 }), 4);
  assert.equal(value('{x<0: -x, x}', { x: -2 }), 2);
  assert.equal(value('{0<x<1: 1, 0}', { x: 2 }), 0);
  assert.ok(Number.isNaN(value('{x>0: 1}', { x: -1 })));
  assert.equal(value('{x}', { x: 5 }), 5);
});

test('sum scoping excludes the index from params', () => {
  assert.deepEqual(parseEquation('\\sum_{n=1}^{N} x^n').params, ['x', 'N']);
});

test('errors carry a position', () => {
  for (const bad of [
    'x +',
    'sin',
    '2 $ 3',
    'atan2(1)',
    'x < 1',
    '\\foo',
    'f(x, x) = x',
    '{x, 1}',
  ]) {
    assert.throws(() => parseEquation(bad), ParseError, bad);
  }
  try {
    parseEquation('x + $');
  } catch (err) {
    assert.equal(err.pos, 4);
  }
});
