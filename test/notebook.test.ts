import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEquation, parseExpression } from '../src/lib/parser.ts';
import { evaluate } from '../src/lib/evaluate.ts';
import { fromLatex, toLatex } from '../src/lib/editor/latex.ts';
import { LANGUAGES } from '../src/lib/generators/index.ts';
import { NOTEBOOK, NOTEBOOK_ENTRIES } from '../src/lib/notebook/data.ts';
import {
  addSaved,
  formatInput,
  matches,
  parseSaved,
  searchText,
} from '../src/lib/notebook/model.ts';

const close = (actual: number, expected: number, tol: number) =>
  Math.abs(actual - expected) <= tol * Math.max(Math.abs(expected), Number.MIN_VALUE);

test('notebook ids are unique and every topic has entries', () => {
  const ids = NOTEBOOK_ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(NOTEBOOK.map((t) => t.id)).size, NOTEBOOK.length);
  for (const topic of NOTEBOOK) assert.ok(topic.entries.length > 0, topic.id);
});

for (const entry of NOTEBOOK_ENTRIES) {
  test(`notebook: ${entry.title}`, () => {
    const def = parseEquation(entry.src);
    assert.equal(def.kind, 'function', 'declares its parameters');
    assert.deepEqual(def.warnings, []);
    // The legend and example list parameters in signature order.
    assert.deepEqual(Object.keys(entry.vars), def.params, 'vars match the parameters');
    assert.deepEqual(Object.keys(entry.example), def.params, 'example matches the parameters');

    // Loads in the visual editor, and what the editor writes back means the same thing.
    const imported = fromLatex(entry.src);
    assert.ok(imported.ok, 'loads in the visual editor');
    const roundTrip = parseEquation(toLatex(imported.root));
    assert.equal(roundTrip.name, def.name, 'editor keeps the name');
    assert.deepEqual(roundTrip.params, def.params, 'editor keeps the parameters');
    assert.ok(close(evaluate(roundTrip.body, entry.example), entry.expect, entry.tol ?? 1e-3));

    // The formula reproduces a known reference value.
    const result = evaluate(def.body, entry.example);
    const tol = entry.tol ?? 1e-3;
    assert.ok(close(result, entry.expect, tol), `got ${result}, expected ${entry.expect}`);

    // Example inputs survive the trip through the Evaluate panel's parser.
    for (const [name, value] of Object.entries(entry.example)) {
      const back = evaluate(parseExpression(formatInput(value)), {});
      assert.ok(close(back, value, 1e-9), `${name}: ${formatInput(value)} -> ${back}`);
    }

    for (const [key, lang] of Object.entries(LANGUAGES)) {
      assert.ok(String(lang.generate(def)).length > 0, `generates ${key}`);
    }
  });
}

test('formatInput avoids e-notation, which the parser reads as Euler’s number', () => {
  assert.equal(formatInput(5.972e24), '5.972*10^24');
  assert.equal(formatInput(6.674e-11), '6.674*10^-11');
  assert.equal(formatInput(-2.5e7), '-2.5*10^7');
  assert.equal(formatInput(9.81), '9.81');
  assert.equal(formatInput(0), '0');
  assert.equal(formatInput(Math.PI / 4), '0.785398163397');
});

test('search matches every word across title, symbols and topic', () => {
  const find = (q: string) =>
    NOTEBOOK.flatMap((t) => t.entries.filter((e) => matches(searchText(e, t.title), q))).map(
      (e) => e.id,
    );
  assert.ok(find('escape').includes('escape-velocity-mass'));
  assert.ok(find('hohmann burn').includes('hohmann-dv1'));
  assert.ok(find('exhaust velocity').includes('tsiolkovsky') === false);
  assert.ok(find('specific impulse').includes('tsiolkovsky'));
  assert.ok(find('Stefan Boltzmann').includes('stefan-boltzmann'));
  assert.ok(find('sutton graves').includes('sutton-graves'), 'ignores the en dash');
  assert.deepEqual(find('zzzz'), []);
});

test('saved equations: parse, dedupe and add', () => {
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved('not json'), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
  const raw = JSON.stringify([
    { id: 'a', title: 'One', src: 'f(x) = x' },
    { id: 'a', title: 'Dup id', src: 'g(x) = x' },
    { id: 'b', title: '', src: ' h(x) = 2x ' },
    { id: 'c', title: 'No src', src: '  ' },
    { id: 4, title: 'Bad id', src: 'x' },
    null,
  ]);
  assert.deepEqual(parseSaved(raw), [
    { id: 'a', title: 'One', src: 'f(x) = x' },
    { id: 'b', title: 'h(x) = 2x', src: 'h(x) = 2x' },
  ]);
  const list = addSaved(parseSaved(raw), 'Again', 'f(x) = x', 'z', { x: '3' });
  assert.deepEqual(
    list.map((e) => e.id),
    ['z', 'b'],
  );
  // Evaluate inputs survive a save and reload; malformed ones are dropped.
  assert.deepEqual(parseSaved(JSON.stringify(list))[0].values, { x: '3' });
  const odd = JSON.stringify([{ id: 'q', title: 'Q', src: 'q(x) = x', values: { x: 1, y: '2' } }]);
  assert.deepEqual(parseSaved(odd)[0].values, { y: '2' });
});
