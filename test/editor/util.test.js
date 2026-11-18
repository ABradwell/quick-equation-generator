import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MathModel } from '../../public/lib/editor/model.js';
import { applySnippet, fnDisplay, isIncomplete } from '../../public/lib/editor/util.js';

test('isIncomplete flags empty slots but not an empty root', () => {
  const m = new MathModel();
  assert.equal(isIncomplete(m.root), false);
  m.typeText('1/');
  assert.equal(isIncomplete(m.root), true);
  m.typeText('2');
  assert.equal(isIncomplete(m.root), false);
  m.moveRight();
  m.typeText('sqrt');
  assert.equal(isIncomplete(m.root), true);
  m.typeText('x');
  assert.equal(isIncomplete(m.root), false);
});

test('isIncomplete looks at a radical index', () => {
  const m = new MathModel();
  m.typeText('nthroot');
  m.moveRight();
  m.typeText('x');
  assert.equal(isIncomplete(m.root), true);
});

test('applySnippet puts the caret at the marker', () => {
  const r = applySnippet('ab', 1, 1, '\\frac{‸}{}');
  assert.equal(r.value, 'a\\frac{}{}b');
  assert.equal(r.start, 1 + '\\frac{'.length);
});

test('applySnippet moves a selection into the first slot', () => {
  const r = applySnippet('x + 1', 0, 5, '\\frac{‸}{}');
  assert.equal(r.value, '\\frac{x + 1}{}');
  assert.equal(r.start, '\\frac{x + 1'.length);
  assert.equal(r.insert, '\\frac{x + 1}{}');
});

test('applySnippet without a marker leaves the caret after the text', () => {
  assert.equal(applySnippet('', 0, 0, 'e').start, 1);
});

test('fnDisplay spells inverse functions like the preview', () => {
  assert.equal(fnDisplay('asin'), 'arcsin');
  assert.equal(fnDisplay('sin'), 'sin');
});
