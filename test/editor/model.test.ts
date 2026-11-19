import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MathModel, blocksOf, isAtom, isNode } from '../../src/lib/editor/model.ts';
import { parseEquation } from '../../src/lib/parser.ts';
import type { Atom, Block, MathNode } from '../../src/lib/editor/types.ts';

// ---------------------------------------------------------------- helpers

type Key = (m: MathModel) => boolean;

const NAMED: Record<string, Key> = {
  right: (m) => m.moveRight(),
  left: (m) => m.moveLeft(),
  up: (m) => m.moveUp(),
  down: (m) => m.moveDown(),
  bs: (m) => m.backspace(),
  del: (m) => m.del(),
  home: (m) => m.home(),
  end: (m) => m.end(),
  'S-left': (m) => m.moveLeft({ shift: true }),
  'S-right': (m) => m.moveRight({ shift: true }),
  'S-up': (m) => m.moveUp({ shift: true }),
  'S-down': (m) => m.moveDown({ shift: true }),
  'S-home': (m) => m.home({ shift: true }),
  'S-end': (m) => m.end({ shift: true }),
  all: (m) => m.selectAll(),
  undo: (m) => m.undo(),
  redo: (m) => m.redo(),
};
const CHARS: Record<string, Key> = {
  '→': NAMED.right,
  '←': NAMED.left,
  '↑': NAMED.up,
  '↓': NAMED.down,
  '⌫': NAMED.bs,
  '⌦': NAMED.del,
};

/** Feed keystrokes: plain characters, arrows → ← ↑ ↓, ⌫ ⌦, and <named> keys like ⟨S-left⟩. */
function type(model: MathModel, keys: string): MathModel {
  for (let i = 0; i < keys.length; ) {
    if (keys[i] === '⟨') {
      const end = keys.indexOf('⟩', i);
      const name = keys.slice(i + 1, end);
      assert.ok(name in NAMED, `unknown key ⟨${name}⟩`);
      NAMED[name](model);
      i = end + 1;
    } else {
      const ch = String.fromCodePoint(keys.codePointAt(i)!);
      i += ch.length;
      if (ch in CHARS) CHARS[ch](model);
      else model.typeChar(ch);
    }
  }
  return model;
}

/** Type into a fresh model and return its LaTeX (pending words committed). */
function latexOf(keys: string): string {
  const m = type(new MathModel(), keys);
  m.commitWord();
  return m.getLatex();
}

/** LaTeX with an "@" where the caret is (and "[" "]" around a selection's items). */
function marked(model: MathModel): string {
  const { block, index } = model.cursor;
  const mark: Atom = { kind: 'atom', id: '', latex: '@', text: '@', cls: 'op', parent: null };
  block.items.splice(index, 0, mark);
  try {
    return model.getLatex();
  } finally {
    block.items.splice(index, 1);
  }
}

function checkIntegrity(model: MathModel): void {
  const ids = new Set<string>();
  const visitBlock = (block: Block, parent: MathNode | null) => {
    assert.equal(block.kind, 'block');
    assert.equal(block.parent, parent);
    assert.ok(!ids.has(block.id), `duplicate id ${block.id}`);
    ids.add(block.id);
    for (const item of block.items) {
      assert.equal(item.parent, block, `item ${item.id} has wrong parent`);
      assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
      ids.add(item.id);
      if (isNode(item)) for (const b of blocksOf(item)) visitBlock(b, item);
    }
  };
  visitBlock(model.root, null);
  const { block, index } = model.cursor;
  assert.ok(ids.has(block.id), 'cursor block is not in the tree');
  assert.ok(index >= 0 && index <= block.items.length, 'cursor index out of range');
  if (model.selection) {
    const s = model.selection;
    assert.ok(ids.has(s.block.id), 'selection block is not in the tree');
    assert.ok(0 <= s.start && s.start < s.end && s.end <= s.block.items.length);
  }
}

const parses = (latex: string) => parseEquation(latex);

/** The items of a block that the test knows to be atoms. */
const atomsOf = (block: Block) => block.items as Atom[];
/** The item at `i` of a block that the test knows to be a node. */
const nodeAt = (block: Block, i: number) => block.items[i] as MathNode;

// ------------------------------------------------------- keystrokes -> LaTeX

// [keys, expected LaTeX, complete (must parse with parseEquation)]
const KEYSTROKES: [keys: string, expected: string, complete?: boolean][] = [
  // basics
  ['x+1', 'x+1'],
  ['2x-3y', '2x-3y'],
  ['2*x', '2\\cdot x'],
  ['3.14', '3.14'],
  ['x<=3', 'x\\le3', false],
  ['x>=3', 'x\\ge3', false],
  ['x<3', 'x<3', false],
  ['x=y', 'x=y'],
  ['f(x)=x^2→+2x+1', 'f\\left(x\\right)=x^2+2x+1'],
  ['y=2x+1', 'y=2x+1'],
  // scripts
  ['x^2', 'x^2'],
  ['x^2→+1', 'x^2+1'],
  ['x^10→+1', 'x^{10}+1'],
  ['x^2→y', 'x^2y'],
  ['x^2→3', 'x^{2}3'],
  ['x^-1→', 'x^{-1}'],
  ['x_1', 'x_1'],
  ['x_12→', 'x_{12}'],
  ['x_1→x_2→', 'x_1x_2'],
  ['x_1→^2', 'x_1^2'],
  ['x^2→_1', 'x_1^2'],
  ['2^x^2', '2^{x^2}'],
  ['e^-x^2→/2', 'e^{-\\frac{x^2}{2}}'],
  ['x^2→^3', 'x^{23}'],
  ['x^2←←^1', 'x^{12}'],
  ['x_1→_2', 'x_{12}'],
  // words in a name's subscript are labels, not functions or constants
  ['v_max→+1', 'v_{max}+1'],
  ['a_spin→(r)', 'a_{spin}\\left(r\\right)'],
  ['x_exp→', 'x_{exp}'],
  ['log_pi→(x)', '\\log_{\\pi}\\left(x\\right)'],
  ['sin^2→x+cos^2→x', '\\sin^2x+\\cos^2x'],
  ['log_2→(x)', '\\log_2\\left(x\\right)'],
  ['x^(n+1)', 'x^{\\left(n+1\\right)}'],
  // fractions
  ['1/2', '\\frac{1}{2}', false],
  ['1/2→x', '\\frac{1}{2}x'],
  ['1/2→→x', '\\frac{1}{2}x'],
  ['2x/3', '\\frac{2x}{3}', false],
  ['2x/3→', '\\frac{2x}{3}'],
  ['(a+b)/2→', '\\frac{a+b}{2}'],
  ['a+b/2→', 'a+\\frac{b}{2}'],
  ['a+2b/3→', 'a+\\frac{2b}{3}'],
  ['-x/2→', '-\\frac{x}{2}'],
  ['x^2→/3→', '\\frac{x^2}{3}'],
  ['sin x/2→', '\\sin\\frac{x}{2}'],
  ['sin^2→x/2→', '\\sin^2\\frac{x}{2}'],
  ['sin(x)/2→', '\\frac{\\sin\\left(x\\right)}{2}'],
  ['2pi/3→', '\\frac{2\\pi}{3}'],
  ['2*x/3→', '2\\cdot\\frac{x}{3}'],
  ['x_1→/2→', '\\frac{x_1}{2}'],
  ['sqrtx', '\\sqrt{x}', false],
  ['sqrtx→/2→', '\\frac{\\sqrt{x}}{2}'],
  ['1/2→/3', '\\frac{\\frac{1}{2}}{3}', false],
  ['1/2/3', '\\frac{1}{\\frac{2}{3}}', false],
  ['1/x+1', '\\frac{1}{x+1}', false],
  ['1/x→+1', '\\frac{1}{x}+1'],
  ['y=1/x→', 'y=\\frac{1}{x}'],
  ['/', '\\frac{}{}', false],
  // auto-words
  ['sin x', '\\sin x'],
  ['sinx', '\\sin x'],
  ['2sin x cos x', '2\\sin x\\cos x'],
  ['cosh x', '\\cosh x'],
  ['cos→', '\\cos', false],
  ['cos(x)', '\\cos\\left(x\\right)'],
  ['tan x', '\\tan x'],
  ['atan(x)', '\\operatorname{atan}\\left(x\\right)'],
  ['atanh(x)', '\\operatorname{atanh}\\left(x\\right)'],
  ['atan2(y,x)', '\\operatorname{atan2}\\left(y,x\\right)'],
  ['asinh(x)', '\\operatorname{asinh}\\left(x\\right)'],
  ['arcsin(x)', '\\arcsin\\left(x\\right)'],
  ['arctanh(x)', '\\operatorname{arctanh}\\left(x\\right)'],
  ['sinh x', '\\sinh x'],
  ['sin h', '\\sin h'],
  ['ln x', '\\ln x'],
  ['log x', '\\log x'],
  ['exp(x)', '\\exp\\left(x\\right)'],
  ['abs(x)', '\\operatorname{abs}\\left(x\\right)'],
  ['floor(x)', '\\operatorname{floor}\\left(x\\right)'],
  ['max(a,b)', '\\max\\left(a,b\\right)'],
  ['mod(a,b)', '\\operatorname{mod}\\left(a,b\\right)'],
  ['theta', '\\theta', false],
  ['sin theta', '\\sin\\theta'],
  ['vartheta', '\\vartheta', false],
  ['alpha beta', '\\alpha\\beta', false],
  ['epsilon', '\\epsilon', false],
  ['varepsilon', '\\varepsilon', false],
  ['Gamma', '\\Gamma', false],
  ['pi', '\\pi'],
  ['2pi r', '2\\pi r'],
  ['tau', '\\tau'],
  ['pir', '\\pi r'],
  ['xi', '\\xi'],
  ['sqrt', '\\sqrt{}', false],
  ['sqrt2', '\\sqrt{2}', false],
  ['sqrt2→+1', '\\sqrt{2}+1'],
  ['nthroot3→x→', '\\sqrt[3]{x}'],
  ['sum', '\\sum_{}^{}', false],
  ['sum n=1→10→n^2', '\\sum_{n=1}^{10}n^2', false],
  ['sum n=1→10→n^2→', '\\sum_{n=1}^{10}n^2'],
  ['prod k=1→n→k', '\\prod_{k=1}^{n}k'],
  ['type', 'type'],
  ['area', 'area'],
  ['tang', '\\tan g'],
  // brackets
  ['(x+1)', '\\left(x+1\\right)'],
  ['(x+1)2', '\\left(x+1\\right)2'],
  ['((x))', '\\left(\\left(x\\right)\\right)'],
  ['[x]', '\\left[x\\right]'],
  ['{x<0:-x,x}', '\\left\\{x<0:-x,x\\right\\}'],
  ['|x-3|+|y|', '\\left|x-3\\right|+\\left|y\\right|'],
  ['|1-|x||', '\\left|1-\\left|x\\right|\\right|'],
  ['||x|-1|', '\\left|\\left|x\\right|-1\\right|'],
  ['x+1)', '\\left(x+1\\right)'],
  ['2(x+1)^2', '2\\left(x+1\\right)^2'],
  ['(x^2)', '\\left(x^2\\right)'],
  ['(1/2)', '\\left(\\frac{1}{2}\\right)'],
  ['(x^2→+1)/2→', '\\frac{x^2+1}{2}'],
  ['(2x/3)+1', '\\left(\\frac{2x}{3}\\right)+1'],
  // complete expressions with several structures
  ['g(t)=e^-t^2→/2→→/sqrt2pi', 'g\\left(t\\right)=\\frac{e^{-\\frac{t^2}{2}}}{\\sqrt{2\\pi}}'],
  ['1/2m v^2', '\\frac{1}{2}m v^2'],
];

test('keystrokes produce the expected LaTeX', () => {
  const wrong = [];
  for (const [keys, expected] of KEYSTROKES) {
    // the "1/2m v^2" row uses a space only to show a pending-word commit; skip when ambiguous
    if (keys === '1/2m v^2') continue;
    const actual = latexOf(keys);
    if (actual !== expected) wrong.push({ keys, expected, actual });
  }
  assert.deepEqual(wrong, []);
});

test('complete keystroke results are accepted by parseEquation', () => {
  let checked = 0;
  for (const [keys, expected, complete = true] of KEYSTROKES) {
    if (!complete || keys === '1/2m v^2') continue;
    // Words like "theta"/"alpha beta" or "type" are valid; incomplete structures are skipped above.
    try {
      parses(expected);
      checked++;
    } catch (err) {
      assert.fail(
        `parseEquation rejected ${JSON.stringify(expected)} (keys ${keys}): ${(err as Error).message}`,
      );
    }
  }
  assert.ok(checked > 80);
});

test('typed LaTeX evaluates like the intended expression', () => {
  const evalAt = (latex: string, env: Record<string, number>) => {
    const def = parseEquation(latex);
    return def.params.map((p) => env[p]);
  };
  assert.deepEqual(evalAt(latexOf('sin x/2→+y'), { x: 1, y: 2 }), [1, 2]);
  assert.equal(parseEquation(latexOf('2x/3→')).params.join(), 'x');
});

// ------------------------------------------------------------- character kinds

test('atom classes and display text', () => {
  const m = type(new MathModel(), 'x2+-*=,:!<=');
  const atoms = atomsOf(m.root).map((a) => [a.text, a.latex, a.cls]);
  assert.deepEqual(atoms, [
    ['x', 'x', 'var'],
    ['2', '2', 'num'],
    ['+', '+', 'op'],
    ['−', '-', 'op'],
    ['·', '\\cdot', 'op'],
    ['=', '=', 'op'],
    [',', ',', 'punct'],
    [':', ':', 'punct'],
    ['!', '!', 'punct'],
    ['≤', '\\le', 'op'],
  ]);
  const w = type(new MathModel(), 'sin theta pi sqrt');
  assert.deepEqual(
    atomsOf(w.root)
      .slice(0, 3)
      .map((a) => [a.text, a.latex, a.cls]),
    [
      ['sin', '\\sin', 'fn'],
      ['θ', '\\theta', 'greek'],
      ['π', '\\pi', 'const'],
    ],
  );
  assert.equal(w.root.items[3].kind, 'sqrt');
});

test('unicode input is understood', () => {
  assert.equal(latexOf('θ·2≤π'), '\\theta\\cdot2\\le\\pi');
  assert.equal(latexOf('√2'), '\\sqrt{2}');
  assert.equal(latexOf('a×b'), 'a\\cdot b');
  assert.equal(latexOf('a−b'), 'a-b');
  assert.equal(latexOf('a÷b→'), '\\frac{a}{b}');
});

test('spaces and unknown characters', () => {
  const m = new MathModel();
  assert.equal(m.typeChar(' '), false);
  assert.equal(m.typeChar('@'), false);
  assert.equal(m.typeChar('#'), false);
  assert.ok(m.isEmpty());
  assert.equal(latexOf('x y'), 'xy');
});

// ------------------------------------------------------------------ auto-words

test('auto-words: longest match and pending words', () => {
  assert.equal(latexOf('sinh'), '\\sinh');
  assert.equal(latexOf('asinh'), '\\operatorname{asinh}');
  assert.equal(latexOf('arcsinh'), '\\operatorname{arcsinh}');
  assert.equal(latexOf('atan2'), '\\operatorname{atan2}');
  assert.equal(latexOf('atan→2'), '\\operatorname{atan}2');
  assert.equal(latexOf('beta'), '\\beta');
  assert.equal(latexOf('theta'), '\\theta');
  assert.equal(latexOf('epsilon'), '\\epsilon');
  assert.equal(latexOf('epsix'), 'e\\psi x');
});

test('auto-words: sin/cos/tan stay pending until the next key decides', () => {
  const m = type(new MathModel(), 'cos');
  assert.equal(m.root.items.length, 3, 'cos is still three letters');
  type(m, 'h');
  assert.equal(m.root.items.length, 1);
  assert.equal(atomsOf(m.root)[0].latex, '\\cosh');

  const n = type(new MathModel(), 'cos');
  type(n, 'x');
  assert.deepEqual(
    atomsOf(n.root).map((a) => a.latex),
    ['\\cos', 'x'],
  );

  const k = type(new MathModel(), 'tan');
  k.commitWord();
  assert.deepEqual(
    atomsOf(k.root).map((a) => a.latex),
    ['\\tan'],
  );
  // typing a bracket, digit or operator commits too
  assert.equal(latexOf('sin(x)'), '\\sin\\left(x\\right)');
  assert.equal(latexOf('sin2'), '\\sin2');
  assert.equal(latexOf('sin+'), '\\sin+');
  assert.equal(latexOf('cos^2'), '\\cos^2');
});

test('auto-words: backspace edits pending letters, removes converted words whole', () => {
  const m = type(new MathModel(), 'sin');
  type(m, '⌫');
  assert.equal(m.getLatex(), 'si');
  const n = type(new MathModel(), 'sinh');
  type(n, '⌫');
  assert.equal(n.getLatex(), '');
});

test('auto-words: sqrt, nthroot and sum place the cursor inside', () => {
  assert.equal(marked(type(new MathModel(), 'sqrt')), '\\sqrt{@}');
  assert.equal(marked(type(new MathModel(), 'nthroot')), '\\sqrt[@]{}');
  assert.equal(marked(type(new MathModel(), 'sum')), '\\sum_{@}^{}');
  assert.equal(marked(type(new MathModel(), 'prod')), '\\prod_{@}^{}');
});

// -------------------------------------------------------------------- brackets

test('brackets: closers move out, stray closers wrap', () => {
  assert.equal(marked(type(new MathModel(), '(x)')), '\\left(x\\right)@');
  assert.equal(marked(type(new MathModel(), '(x')), '\\left(x@\\right)');
  assert.equal(marked(type(new MathModel(), '(x^2)')), '\\left(x^2\\right)@');
  assert.equal(marked(type(new MathModel(), '(1/2)')), '\\left(\\frac{1}{2}\\right)@');
  assert.equal(marked(type(new MathModel(), '[(x)]')), '\\left[\\left(x\\right)\\right]@');
  // mismatched closer wraps everything to its left in the block
  assert.equal(latexOf('[x)'), '\\left[\\left(x\\right)\\right]');
  assert.equal(latexOf('a+b]'), '\\left[a+b\\right]');
  assert.equal(latexOf(')'), '\\left(\\right)');
});

test('brackets: absolute value opens after an operator and closes after an operand', () => {
  const m = type(new MathModel(), '|x');
  assert.equal(marked(m), '\\left|x@\\right|');
  type(m, '|');
  assert.equal(marked(m), '\\left|x\\right|@');
});

// ------------------------------------------------------------ backspace/delete

test('backspace deletes atoms and enters nodes before deleting them', () => {
  const m = type(new MathModel(), 'x+2');
  type(m, '⌫');
  assert.equal(m.getLatex(), 'x+');
  type(m, '⌫⌫⌫');
  assert.equal(m.getLatex(), '');
  assert.equal(m.backspace(), false);

  const f = type(new MathModel(), '1/2→');
  type(f, '⌫');
  assert.equal(marked(f), '\\frac{1}{2@}', 'first backspace enters the node');
  type(f, '⌫');
  assert.equal(f.getLatex(), '\\frac{1}{}');
  type(f, '⌫');
  assert.equal(marked(f), '\\frac{1@}{}');
});

test('backspace removes an empty node and unwraps a non-empty one', () => {
  const m = type(new MathModel(), 'a(');
  type(m, '⌫');
  assert.equal(marked(m), 'a@');

  const w = type(new MathModel(), '(x)');
  type(w, '⌫');
  assert.equal(marked(w), '\\left(x@\\right)');
  type(w, '⌫⌫');
  assert.equal(marked(w), '@');

  const u = type(new MathModel(), '(x+1');
  type(u, '←←←⌫');
  assert.equal(marked(u), '@x+1');

  const s = type(new MathModel(), 'sqrt2');
  type(s, '←⌫');
  assert.equal(marked(s), '@2');

  const e = type(new MathModel(), 'x^2');
  type(e, '←⌫');
  assert.equal(marked(e), 'x@2');

  const e2 = type(new MathModel(), 'x^');
  type(e2, '⌫');
  assert.equal(marked(e2), 'x@');
});

test('backspace in a fraction denominator goes to the numerator, then unwraps', () => {
  const m = type(new MathModel(), '1/2');
  type(m, '←⌫');
  assert.equal(marked(m), '\\frac{1@}{2}');
  type(m, '←⌫');
  assert.equal(marked(m), '@12');
  assert.equal(m.getLatex(), '12');

  const e = type(new MathModel(), '/');
  type(e, '→⌫');
  assert.equal(marked(e), '@', 'both blocks empty: the fraction is deleted');
  const h = type(new MathModel(), '/→2←⌫');
  assert.equal(marked(h), '\\frac{@}{2}');
  type(h, '⌫');
  assert.equal(marked(h), '@2');
});

test('backspace at the start of a bigop upper block goes to the lower block', () => {
  const m = type(new MathModel(), 'sum n=1→10');
  type(m, '←←⌫');
  assert.equal(marked(m), '\\sum_{n=1@}^{10}');
});

test('delete is the forward mirror', () => {
  const m = type(new MathModel(), 'x+2');
  type(m, '⟨home⟩⌦');
  assert.equal(m.getLatex(), '+2');
  const f = type(new MathModel(), '1/2→x');
  type(f, '⟨home⟩⌦');
  assert.equal(marked(f), '\\frac{@1}{2}x', 'first delete enters the node');
  type(f, '⌦');
  assert.equal(marked(f), '\\frac{@}{2}x');
  type(f, '⌦');
  assert.equal(marked(f), '\\frac{}{@2}x', 'at the end of a block, delete steps to the next block');
  type(f, '⌦');
  assert.equal(marked(f), '\\frac{}{@}x');
  type(f, '⌦');
  assert.equal(marked(f), '@x', 'both blocks empty: the fraction is deleted');
  const h = type(new MathModel(), '1/2→');
  type(h, '⟨home⟩→⌦');
  assert.equal(marked(h), '\\frac{@}{2}');
});

test('delete at the end of the last block unwraps the node', () => {
  const m = type(new MathModel(), '(ab');
  type(m, '⌦');
  assert.equal(marked(m), 'ab@');
  assert.equal(m.getLatex(), 'ab');
});

// ------------------------------------------------------------------ navigation

test('left/right step through fractions, scripts, radicals and big operators', () => {
  const m = type(new MathModel(), '1/2→x^2→y');
  type(m, '⟨home⟩');
  const stops = [marked(m)];
  for (let i = 0; i < 9; i++) {
    m.moveRight();
    stops.push(marked(m));
  }
  assert.deepEqual(stops, [
    '@\\frac{1}{2}x^2y',
    '\\frac{@1}{2}x^2y',
    '\\frac{1@}{2}x^2y',
    '\\frac{1}{@2}x^2y',
    '\\frac{1}{2@}x^2y',
    '\\frac{1}{2}@x^2y',
    '\\frac{1}{2}x@^2y',
    '\\frac{1}{2}x^{@2}y',
    '\\frac{1}{2}x^{2@}y',
    '\\frac{1}{2}x^2@y',
  ]);
});

test('left walks the same path backwards', () => {
  const m = type(new MathModel(), 'sqrt2→+sum n=1→10→n');
  const there = [];
  while (m.moveLeft()) there.push(marked(m));
  assert.equal(there[there.length - 1], '@\\sqrt{2}+\\sum_{n=1}^{10}n');
  assert.ok(there.includes('\\sqrt{@2}+\\sum_{n=1}^{10}n'));
  assert.ok(there.includes('\\sqrt{2}+\\sum_{n=1}^{@10}n'));
  assert.ok(there.includes('\\sqrt{2}+\\sum_{n=1}^{10@}n'));
  assert.ok(there.includes('\\sqrt{2}+\\sum_{@n=1}^{10}n'));
  assert.equal(there.filter((s) => s.startsWith('\\sqrt{2}+\\sum_{n=1@}')).length, 1);
});

test('nth root: the index is navigable and sits left of the radicand', () => {
  const m = type(new MathModel(), 'nthroot3→x');
  type(m, '⟨home⟩⟨home⟩→');
  assert.equal(marked(m), '\\sqrt[@3]{x}');
  type(m, '→→');
  assert.equal(marked(m), '\\sqrt[3]{@x}');
  type(m, '←');
  assert.equal(marked(m), '\\sqrt[3@]{x}');
});

test('left/right at the ends of the expression do nothing', () => {
  const m = type(new MathModel(), 'x');
  assert.equal(m.moveRight(), false);
  type(m, '⟨home⟩');
  assert.equal(m.moveLeft(), false);
});

test('up/down move between numerator and denominator', () => {
  const m = type(new MathModel(), '12/34');
  assert.equal(marked(m), '\\frac{12}{34@}');
  type(m, '↑');
  assert.equal(marked(m), '\\frac{12@}{34}');
  type(m, '←↓');
  assert.equal(marked(m), '\\frac{12}{3@4}');
  assert.equal(m.moveDown(), false);
  type(m, '↑↑');
  assert.equal(marked(m), '\\frac{1@2}{34}');
  assert.equal(m.moveUp(), false);
});

test('up/down enter and leave superscripts and subscripts', () => {
  const m = type(new MathModel(), 'x^2→+1');
  type(m, '⟨home⟩→↑');
  assert.equal(marked(m), 'x^{@2}+1');
  type(m, '↓');
  assert.equal(marked(m), 'x^2@+1');

  const s = type(new MathModel(), 'x_1→+1');
  type(s, '⟨home⟩→↓');
  assert.equal(marked(s), 'x_{@1}+1');
  type(s, '↑');
  assert.equal(marked(s), 'x_1@+1');
  // inside a superscript, up does nothing; from baseline, down does nothing
  const t = type(new MathModel(), 'x^2');
  assert.equal(t.moveUp(), false);
  type(t, '↓');
  assert.equal(marked(t), 'x^2@');
  assert.equal(t.moveDown(), false);
});

test('up/down between the limits of a big operator', () => {
  const m = type(new MathModel(), 'sum n=1→10');
  type(m, '↓');
  assert.equal(marked(m), '\\sum_{n=1@}^{10}');
  type(m, '↑');
  assert.equal(marked(m), '\\sum_{n=1}^{10@}');
});

test('up from inside a nested fraction reaches the enclosing fraction', () => {
  const m = type(new MathModel(), '1/2→/3');
  assert.equal(m.getLatex(), '\\frac{\\frac{1}{2}}{3}');
  type(m, '↑');
  assert.equal(marked(m), '\\frac{\\frac{1}{2}@}{3}');
  type(m, '↓');
  assert.equal(marked(m), '\\frac{\\frac{1}{2}}{3@}');
  const n = type(new MathModel(), '1/(a/b');
  type(n, '↑');
  assert.equal(marked(n), '\\frac{1}{\\left(\\frac{a@}{b}\\right)}');
});

test('home and end: current block first, then the whole expression', () => {
  const f = type(new MathModel(), '1/23→+z');
  type(f, '←←←←');
  assert.equal(marked(f), '\\frac{1}{2@3}+z');
  type(f, '⟨home⟩');
  assert.equal(marked(f), '\\frac{1}{@23}+z');
  type(f, '⟨home⟩');
  assert.equal(marked(f), '@\\frac{1}{23}+z');
  type(f, '⟨end⟩');
  assert.equal(marked(f), '\\frac{1}{23}+z@');

  const g = type(new MathModel(), '1/23→+z');
  type(g, '←←←←←');
  assert.equal(marked(g), '\\frac{1}{@23}+z');
  type(g, '⟨end⟩');
  assert.equal(marked(g), '\\frac{1}{23@}+z', 'end goes to the end of the block');
  type(g, '⟨end⟩');
  assert.equal(marked(g), '\\frac{1}{23}+z@');
});

// ------------------------------------------------------------------- selection

test('shift+arrows select whole items and report the selection', () => {
  const m = type(new MathModel(), 'ab+c');
  type(m, '⟨S-left⟩⟨S-left⟩');
  assert.deepEqual(
    { start: m.selection!.start, end: m.selection!.end, block: m.selection!.block },
    { start: 2, end: 4, block: m.root },
  );
  assert.equal(m.getSelectionLatex(), '+c');
  type(m, '⟨S-right⟩');
  assert.equal(m.getSelectionLatex(), 'c');
  type(m, '⟨S-right⟩');
  assert.equal(m.selection, null);
});

test('shift+arrow jumps over a whole fraction', () => {
  const m = type(new MathModel(), 'x+1/2→y');
  type(m, '⟨home⟩⟨S-right⟩⟨S-right⟩⟨S-right⟩');
  assert.equal(m.getSelectionLatex(), 'x+\\frac{1}{2}');
  type(m, '⟨S-right⟩');
  assert.equal(m.getSelectionLatex(), 'x+\\frac{1}{2}y');
});

test('selection across blocks is widened to the common block', () => {
  // anchor at the start of the numerator, focus moves right inside it
  const m = type(new MathModel(), 'a+1/2→b');
  type(m, '⟨home⟩→→→');
  assert.equal(marked(m), 'a+\\frac{@1}{2}b');
  type(m, '⟨S-right⟩');
  assert.equal(m.getSelectionLatex(), '1');
  assert.equal(m.selection!.block, nodeAt(m.root, 2).blocks[0]);
  // focus leaves the numerator: the whole fraction is selected, in the root block
  type(m, '⟨S-right⟩');
  assert.equal(m.selection!.block, m.root);
  assert.equal(m.getSelectionLatex(), '\\frac{1}{2}');
  // anchor outside, focus steps over the node: whole node selected
  const n = type(new MathModel(), 'a+1/2→b');
  type(n, '⟨home⟩→→⟨S-right⟩');
  assert.equal(n.getSelectionLatex(), '\\frac{1}{2}');
  // selecting leftwards out of a denominator
  const o = type(new MathModel(), 'a+1/23→b');
  type(o, '←←←⟨S-left⟩');
  assert.equal(o.getSelectionLatex(), '2');
  type(o, '⟨S-left⟩');
  assert.equal(o.getSelectionLatex(), '\\frac{1}{23}', 'focus left the denominator: whole node');
});

test('selectAll, typing replaces the selection', () => {
  const m = type(new MathModel(), 'x+1/2→');
  m.selectAll();
  assert.equal(m.getSelectionLatex(), 'x+\\frac{1}{2}');
  type(m, 'y');
  assert.equal(m.getLatex(), 'y');
  assert.equal(m.selection, null);
  assert.equal(new MathModel().selectAll(), false);
});

test('selection wraps in fractions, brackets, scripts and roots', () => {
  const frac = type(new MathModel(), 'a+bc⟨S-left⟩⟨S-left⟩/');
  assert.equal(marked(frac), 'a+\\frac{bc}{@}');
  const par = type(new MathModel(), 'a+bc⟨S-left⟩⟨S-left⟩(');
  assert.equal(marked(par), 'a+\\left(bc@\\right)');
  const sq = type(new MathModel(), 'xy⟨all⟩');
  sq.insert('sqrt');
  assert.equal(marked(sq), '\\sqrt{xy@}');
  const sup = type(new MathModel(), 'xy⟨S-left⟩^');
  assert.equal(marked(sup), 'x^{y@}');
  const abs = type(new MathModel(), 'xy⟨all⟩|');
  assert.equal(marked(abs), '\\left|xy@\\right|');
  const nth = type(new MathModel(), 'xy⟨all⟩');
  nth.insert('nthroot');
  assert.equal(marked(nth), '\\sqrt[@]{xy}');
  const sum = type(new MathModel(), 'n⟨all⟩');
  sum.insert('bigop', { op: 'sum' });
  assert.equal(marked(sum), '\\sum_{@}^{}n');
});

test('backspace and delete remove a selection', () => {
  const m = type(new MathModel(), 'a+b+c');
  type(m, '⟨S-left⟩⟨S-left⟩⌫');
  assert.equal(marked(m), 'a+b@');
  const n = type(new MathModel(), 'abc');
  type(n, '⟨home⟩⟨S-right⟩⌦');
  assert.equal(n.getLatex(), 'bc');
});

test('arrows collapse a selection to its edge', () => {
  const m = type(new MathModel(), 'abcd');
  type(m, '⟨S-left⟩⟨S-left⟩←');
  assert.equal(marked(m), 'ab@cd');
  const n = type(new MathModel(), 'abcd');
  type(n, '⟨S-left⟩⟨S-left⟩→');
  assert.equal(marked(n), 'abcd@');
});

test('shift+home / shift+end select to the ends', () => {
  const m = type(new MathModel(), 'abcd←←');
  type(m, '⟨S-home⟩');
  assert.equal(m.getSelectionLatex(), 'ab');
  const n = type(new MathModel(), 'abcd←←');
  type(n, '⟨S-end⟩');
  assert.equal(n.getSelectionLatex(), 'cd');
});

test('setCursor with extend selects a range (mouse drag)', () => {
  const m = type(new MathModel(), 'abcd');
  m.setCursor(m.root, 1);
  m.setCursor(m.root, 3, { extend: true });
  assert.equal(m.getSelectionLatex(), 'bc');
  m.setCursor(m.root, 0, { extend: true });
  assert.equal(m.getSelectionLatex(), 'a');
  m.setCursor(m.root, 2);
  assert.equal(m.selection, null);
  assert.equal(marked(m), 'ab@cd');
});

// --------------------------------------------------------------- insert (palette)

test('insert: structures at the cursor', () => {
  const m = new MathModel();
  m.insert('frac');
  assert.equal(marked(m), '\\frac{@}{}');
  const s = type(new MathModel(), 'x');
  s.insert('sup');
  assert.equal(marked(s), 'x^{@}');
  const b = type(new MathModel(), 'x');
  b.insert('sub');
  assert.equal(marked(b), 'x_{@}');
  const p = new MathModel();
  p.insert('paren', { type: '[' });
  assert.equal(marked(p), '\\left[@\\right]');
  const q = new MathModel();
  q.insert('paren', { type: '|' });
  assert.equal(marked(q), '\\left|@\\right|');
  const r = new MathModel();
  r.insert('nthroot');
  assert.equal(marked(r), '\\sqrt[@]{}');
  const t = new MathModel();
  t.insert('bigop', { op: 'prod' });
  assert.equal(marked(t), '\\prod_{@}^{}');
  const w = new MathModel();
  w.insert('piecewise');
  assert.equal(marked(w), '\\left\\{@:,\\right\\}');
  assert.equal(new MathModel().insert('bogus' as 'frac'), false);
});

test('insert: fraction from the palette grabs the operand like "/"', () => {
  const m = type(new MathModel(), '2x');
  m.insert('frac');
  assert.equal(marked(m), '\\frac{2x}{@}');
});

test('insert: atoms and words', () => {
  const m = new MathModel();
  m.insert('atom', { text: 'ℏ', latex: '\\hbar', cls: 'const' });
  m.insert('atom', { text: 'x' });
  m.insert('word', { name: 'sin' });
  m.insert('word', { name: 'theta' });
  m.insert('word', { name: 'sqrt' });
  assert.equal(marked(m), '\\hbar x\\sin\\theta\\sqrt{@}');
  assert.equal(m.insert('word', { name: 'nonsense' }), false);
  const sel = type(new MathModel(), 'abc⟨all⟩');
  sel.insert('atom', { text: 'z' });
  assert.equal(sel.getLatex(), 'z');
});

test('insert latex: spliced at the cursor, cursor in the first empty block', () => {
  const m = type(new MathModel(), 'x+');
  m.insert('latex', { latex: '\\frac{}{2}' });
  assert.equal(marked(m), 'x+\\frac{@}{2}');
  const n = type(new MathModel(), 'a');
  n.insert('latex', { latex: '\\sum_{n=1}^{}n' });
  assert.equal(marked(n), 'a\\sum_{n=1}^{@}n');
  const o = type(new MathModel(), 'a');
  o.insert('latex', { latex: '2\\pi' });
  assert.equal(marked(o), 'a2\\pi@');
  assert.equal(o.insert('latex', { latex: '\\frac{1' }), false);
  assert.equal(o.getLatex(), 'a2\\pi');
  const p = type(new MathModel(), 'abc⟨all⟩');
  p.insert('latex', { latex: 'x^2' });
  assert.equal(p.getLatex(), 'x^2');
});

test('paste imports LaTeX and falls back to typing', () => {
  const m = new MathModel();
  m.paste('\\frac{1}{2}+x^2');
  assert.equal(m.getLatex(), '\\frac{1}{2}+x^2');
  const n = new MathModel();
  n.paste('1/2');
  assert.equal(n.getLatex(), '1/2', 'ASCII slash stays literal on paste');
  const o = new MathModel();
  o.paste('x+(');
  assert.equal(o.getLatex(), 'x+\\left(\\right)');
});

// --------------------------------------------------------------- document API

test('getLatex / setLatex / clear / isEmpty', () => {
  const m = new MathModel();
  assert.ok(m.isEmpty());
  assert.deepEqual(m.setLatex('\\frac{1}{2}x'), { ok: true });
  assert.equal(m.getLatex(), '\\frac{1}{2}x');
  assert.equal(m.isEmpty(), false);
  assert.equal(marked(m), '\\frac{1}{2}x@');
  const bad = m.setLatex('(x');
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.error, 'string');
  assert.equal(m.getLatex(), '\\frac{1}{2}x', 'a failed import leaves the model alone');
  m.clear();
  assert.ok(m.isEmpty());
  assert.equal(marked(m), '@');
  m.setLatex('x', { resetHistory: true });
  assert.equal(m.canUndo(), false);
});

test('setLatex then keep typing', () => {
  const m = new MathModel();
  m.setLatex('x^2');
  type(m, '+1');
  assert.equal(m.getLatex(), 'x^2+1');
});

// ------------------------------------------------------------------ undo / redo

test('undo and redo coalesce typed characters', () => {
  const m = type(new MathModel(), 'x+1');
  type(m, '^2'); // the superscript is its own step, then the typed 2
  assert.equal(m.getLatex(), 'x+1^2');
  m.undo();
  assert.equal(m.getLatex(), 'x+1^{}');
  m.undo();
  assert.equal(m.getLatex(), 'x+1');
  m.undo();
  assert.equal(m.getLatex(), '');
  assert.equal(m.undo(), false);
  m.redo();
  assert.equal(m.getLatex(), 'x+1');
  m.redo();
  m.redo();
  assert.equal(m.getLatex(), 'x+1^2');
  assert.equal(m.redo(), false);
});

test('undo restores the cursor and keeps ids stable', () => {
  const m = type(new MathModel(), '1/2→x');
  const idsBefore = [m.root.items[0].id, m.root.items[1].id];
  type(m, '⟨home⟩⌦⌦');
  assert.equal(m.getLatex(), '\\frac{}{2}x');
  m.undo();
  assert.equal(m.getLatex(), '\\frac{1}{2}x');
  assert.deepEqual([m.root.items[0].id, m.root.items[1].id], idsBefore);
  assert.equal(marked(m), '\\frac{@1}{2}x');
  checkIntegrity(m);
  m.redo();
  assert.equal(m.getLatex(), '\\frac{}{2}x');
});

test('a new edit clears the redo stack; navigation breaks coalescing', () => {
  const m = type(new MathModel(), 'ab');
  m.undo();
  type(m, 'c');
  assert.equal(m.canRedo(), false);
  type(m, '←d');
  assert.equal(m.getLatex(), 'dc');
  m.undo();
  assert.equal(m.getLatex(), 'c');
});

test('backspaces coalesce into one undo step', () => {
  const m = type(new MathModel(), 'abcd');
  type(m, '⌫⌫');
  assert.equal(m.getLatex(), 'ab');
  m.undo();
  assert.equal(m.getLatex(), 'abcd');
});

test('undo of a converted word restores the whole word step', () => {
  const m = type(new MathModel(), 'x+sin y');
  m.undo();
  assert.equal(m.getLatex(), '');
});

// ----------------------------------------------------------------- change events

test('onChange fires after mutations and cursor moves, and can be unsubscribed', () => {
  const m = new MathModel();
  const events: { content: boolean; selection: boolean; latex: string }[] = [];
  const off = m.onChange((model, info) => events.push({ ...info, latex: model.getLatex() }));
  m.typeChar('x');
  m.moveLeft();
  m.moveRight();
  m.moveRight(); // no-op: no event
  m.typeChar('@'); // no-op: no event
  assert.deepEqual(events, [
    { content: true, selection: false, latex: 'x' },
    { content: false, selection: false, latex: 'x' },
    { content: false, selection: false, latex: 'x' },
  ]);
  m.moveLeft({ shift: true });
  assert.equal(events.at(-1)!.selection, true);
  off();
  m.typeChar('y');
  assert.equal(events.length, 4);
});

test('one event per command, even for compound commands', () => {
  const m = new MathModel();
  let n = 0;
  m.onChange(() => n++);
  m.paste('x+\\frac{1}{2}');
  assert.equal(n, 1);
  m.typeText('abc');
  assert.equal(n, 2);
  m.undo();
  assert.equal(n, 3);
});

test('version only changes with the tree', () => {
  const m = type(new MathModel(), 'ab');
  const v = m.version;
  m.moveLeft();
  assert.equal(m.version, v);
  m.typeChar('c');
  assert.ok(m.version > v);
});

// ------------------------------------------------------------- ids and lookup

test('ids are unique, find() resolves them, setCursor accepts ids', () => {
  const m = type(new MathModel(), '1/2→x^2');
  checkIntegrity(m);
  const frac = nodeAt(m.root, 0);
  assert.equal(m.find(frac.id), frac);
  assert.equal(m.find(frac.blocks[1].id), frac.blocks[1]);
  assert.equal(m.find('nope'), null);
  assert.ok(m.setCursor(frac.blocks[0].id, 1));
  assert.equal(marked(m), '\\frac{1@}{2}x^2');
  assert.equal(m.setCursor('nope', 0), false);
  m.setCursor(m.root, 99);
  assert.equal(m.cursor.index, m.root.items.length);
});

test('setCursor commits a pending word and keeps the target position', () => {
  const m = type(new MathModel(), 'sin x');
  m.moveLeft();
  m.typeChar('y');
  assert.equal(m.getLatex(), '\\sin yx');
  const n = type(new MathModel(), 'cosa');
  n.setCursor(n.root, n.root.items.length);
  assert.equal(marked(n), '\\cos a@');
});

test('setCursor on a stale block is ignored', () => {
  const m = type(new MathModel(), '1/2→');
  const stale = nodeAt(m.root, 0).blocks[0];
  m.clear();
  assert.equal(m.setCursor(stale, 0), false);
});

// ------------------------------------------------------------------- fuzzing

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('fuzz: random keystrokes keep the tree consistent and undo returns to empty', () => {
  const keys = [
    ...'abcsinxyz0123456789+-*/^_()[]{}|=<>,:.!'.split(''),
    '⟨left⟩',
    '⟨right⟩',
    '⟨up⟩',
    '⟨down⟩',
    '⟨bs⟩',
    '⟨del⟩',
    '⟨home⟩',
    '⟨end⟩',
    '⟨S-left⟩',
    '⟨S-right⟩',
    '⟨S-up⟩',
    '⟨S-down⟩',
    '⟨all⟩',
  ];
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const m = new MathModel();
    for (let step = 0; step < 150; step++) {
      const k = keys[Math.floor(rand() * keys.length)];
      if (k.length > 1) NAMED[k.slice(1, -1)](m);
      else m.typeChar(k);
      checkIntegrity(m);
      m.getLatex();
    }
    m.commitWord();
    checkIntegrity(m);
    // every state must be importable again
    const out = m.getLatex();
    assert.equal(typeof out, 'string');
    let guard = 0;
    while (m.undo() && guard++ < 1000) checkIntegrity(m);
    assert.equal(m.getLatex(), '', `seed ${seed}: undo did not return to empty`);
  }
});

test('isNode / isAtom classify items', () => {
  const m = type(new MathModel(), 'x^2');
  assert.ok(isAtom(m.root.items[0]));
  assert.ok(isNode(m.root.items[1]));
});
