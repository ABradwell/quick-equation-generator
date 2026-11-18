// Button palette above the equation field. In visual mode a button edits the MathModel through the
// editor; in text mode it inserts a LaTeX snippet at the caret of the plain text box.
import { applySnippet } from './util.js';

const LATEX_FN = new Set('sin cos tan sec csc cot sinh cosh tanh exp ln log'.split(' '));
const GREEK = Object.fromEntries(
  Object.entries({
    alpha: 'α',
    beta: 'β',
    gamma: 'γ',
    delta: 'δ',
    epsilon: 'ε',
    zeta: 'ζ',
    eta: 'η',
    theta: 'θ',
    iota: 'ι',
    kappa: 'κ',
    lambda: 'λ',
    mu: 'μ',
    nu: 'ν',
    xi: 'ξ',
    rho: 'ρ',
    sigma: 'σ',
    tau: 'τ',
    upsilon: 'υ',
    phi: 'φ',
    chi: 'χ',
    psi: 'ψ',
    omega: 'ω',
    Gamma: 'Γ',
    Delta: 'Δ',
    Theta: 'Θ',
    Lambda: 'Λ',
    Xi: 'Ξ',
    Sigma: 'Σ',
    Phi: 'Φ',
    Psi: 'Ψ',
    Omega: 'Ω',
  }),
);

const box = '<i class="pg-box"></i>';
const glyph = {
  frac: `<span class="m-frac"><span class="m-num">${box}</span><span class="m-den">${box}</span></span>`,
  sup: `<span class="m-v">x</span><span class="pg-sup">n</span>`,
  square: `<span class="m-v">x</span><span class="pg-sup">2</span>`,
  sub: `<span class="m-v">x</span><span class="pg-sub">n</span>`,
  sqrt: `<span class="pg-rt"><span>${box}</span></span>`,
  nthroot: `<span class="pg-idx">n</span><span class="pg-rt"><span>${box}</span></span>`,
  abs: `<span class="pg-bar">|</span><span class="m-v">x</span><span class="pg-bar">|</span>`,
  paren: `<span class="pg-p">(</span>${box}<span class="pg-p">)</span>`,
  sum: '∑',
  prod: '∏',
  piecewise: `<span class="pg-brace">{</span><span class="pg-rows"><span>${box}</span><span>${box}</span></span>`,
};

const run = (name, label) => ({
  id: name,
  label,
  glyph: `<span class="m-fn">${label}</span>`,
  fn: name,
});

const GROUPS = [
  {
    id: 'structure',
    label: 'Structure',
    items: [
      {
        id: 'frac',
        label: 'Fraction',
        tip: 'Type / for a fraction',
        glyph: glyph.frac,
        v: (ed) => ed.insert('frac'),
        t: '\\frac{‸}{}',
      },
      {
        id: 'sup',
        label: 'Power',
        tip: 'Type ^ for a power',
        glyph: glyph.sup,
        v: (ed) => ed.insert('sup'),
        t: '^{‸}',
      },
      {
        id: 'square',
        label: 'Square',
        tip: 'Type ^2 for a square',
        glyph: glyph.square,
        v: squareV,
        t: '^{2}',
      },
      {
        id: 'sub',
        label: 'Subscript',
        tip: 'Type _ for a subscript',
        glyph: glyph.sub,
        v: (ed) => ed.insert('sub'),
        t: '_{‸}',
      },
      {
        id: 'sqrt',
        label: 'Square root',
        tip: 'Type sqrt for a square root',
        glyph: glyph.sqrt,
        v: (ed) => ed.insert('sqrt'),
        t: '\\sqrt{‸}',
      },
      {
        id: 'nthroot',
        label: 'Nth root',
        tip: 'Type nthroot for an nth root',
        glyph: glyph.nthroot,
        v: (ed) => ed.insert('nthroot'),
        t: '\\sqrt[‸]{}',
      },
      {
        id: 'abs',
        label: 'Absolute value',
        tip: 'Type | for absolute value',
        glyph: glyph.abs,
        v: (ed) => ed.insert('paren', { type: '|' }),
        t: '|‸|',
      },
      {
        id: 'paren',
        label: 'Brackets',
        tip: 'Type ( for brackets',
        glyph: glyph.paren,
        v: (ed) => ed.insert('paren', { type: '(' }),
        t: '(‸)',
      },
      {
        id: 'sum',
        label: 'Sum',
        tip: 'Type sum for a sum',
        glyph: glyph.sum,
        v: (ed) => ed.insert('bigop', { op: 'sum' }),
        t: '\\sum_{‸}^{}',
      },
      {
        id: 'prod',
        label: 'Product',
        tip: 'Type prod for a product',
        glyph: glyph.prod,
        v: (ed) => ed.insert('bigop', { op: 'prod' }),
        t: '\\prod_{‸}^{}',
      },
      {
        id: 'piecewise',
        label: 'Piecewise',
        tip: 'Piecewise: {x<0: -x, x}',
        glyph: glyph.piecewise,
        v: (ed) => ed.insert('piecewise'),
        t: '{‸: , }',
      },
    ],
  },
  {
    id: 'functions',
    label: 'Functions',
    items: [
      ...['sin', 'cos', 'tan', 'ln', 'log', 'exp'].map((n) => ({
        ...run(n, n),
        tip: `Type ${n}`,
        v: (ed) => insertFn(ed, n),
        t: `${LATEX_FN.has(n) ? '\\' : ''}${n}(‸)`,
      })),
    ],
    more: {
      id: 'more-fns',
      label: 'More functions',
      toggle: 'more',
      cols: 4,
      items: [
        ['asin', 'arcsin'],
        ['acos', 'arccos'],
        ['atan', 'arctan'],
        ['atan2', 'atan2', 2],
        ['sinh'],
        ['cosh'],
        ['tanh'],
        ['sec'],
        ['csc'],
        ['cot'],
        ['asinh', 'arsinh'],
        ['acosh', 'arcosh'],
        ['atanh', 'artanh'],
        ['floor'],
        ['ceil'],
        ['round'],
        ['abs'],
        ['sign'],
        ['min', 'min', 2],
        ['max', 'max', 2],
        ['mod', 'mod', 2],
      ].map(([n, label = n, args = 1]) => ({
        id: n,
        label,
        tip: `Type ${n}`,
        glyph: `<span class="m-fn">${label}</span>`,
        v: (ed) => insertFn(ed, n),
        t: `${LATEX_FN.has(n) ? '\\' : ''}${n}(‸${args > 1 ? ', ' : ''})`,
      })),
    },
  },
  {
    id: 'symbols',
    label: 'Symbols',
    items: [
      {
        id: 'pi',
        label: 'Pi',
        tip: 'Type pi',
        glyph: '<span class="m-c">π</span>',
        v: (ed) => ed.insert('word', { name: 'pi' }),
        t: '\\pi ‸',
      },
      {
        id: 'e',
        label: 'Euler’s number e',
        tip: 'Type e',
        glyph: '<span class="m-c">e</span>',
        v: (ed) => ed.insert('atom', { text: 'e', latex: 'e', cls: 'var' }),
        t: 'e',
      },
      {
        id: 'theta',
        label: 'Theta',
        tip: 'Type theta',
        glyph: '<span class="m-v">θ</span>',
        v: (ed) => ed.insert('word', { name: 'theta' }),
        t: '\\theta ‸',
      },
      ...[
        ['≤', 'Less than or equal', 'Type <=', '\\le '],
        ['≥', 'Greater than or equal', 'Type >=', '\\ge '],
        ['<', 'Less than', 'Type <', '<'],
        ['>', 'Greater than', 'Type >', '>'],
      ].map(([ch, label, tip, latex]) => ({
        id: label,
        label,
        tip,
        glyph: `<span class="m-op pg-op">${ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch}</span>`,
        v: (ed) => ed.model.typeChar(ch),
        t: latex,
      })),
    ],
    more: {
      id: 'greek',
      label: 'Greek letters',
      toggle: 'αβγ',
      cols: 8,
      items: [
        ...'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi rho sigma tau upsilon phi chi psi omega'.split(
          ' ',
        ),
        ...'Gamma Delta Theta Lambda Xi Sigma Phi Psi Omega'.split(' '),
      ].map((name) => ({
        id: name,
        label: name,
        tip: `Type ${name}`,
        glyph: `<span class="${name[0] === name[0].toUpperCase() ? 'm-c' : 'm-v'}">${GREEK[name]}</span>`,
        v: (ed) => ed.insert('word', { name }),
        t: `\\${name} ‸`,
      })),
    },
  },
];

function squareV(ed) {
  const had = !!ed.model.selection;
  ed.insert('sup');
  if (!had) {
    ed.model.typeChar('2');
    ed.model.moveRight();
  }
}

/** sin(), floor(), ...: wraps the selection in brackets, otherwise leaves the caret inside them. */
function insertFn(ed, name) {
  const m = ed.model;
  if (m.selection) {
    ed.insert('paren', { type: '(' });
    m.home();
    m.moveLeft();
    ed.insert('word', { name });
    m.moveRight();
    m.end();
  } else {
    ed.insert('word', { name });
    ed.insert('paren', { type: '(' });
  }
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/**
 * Build the palette inside `container`.
 * options: getMode() -> 'visual' | 'text', editor (createEditor result), textInput (the <input>),
 * onTextInsert() called after a snippet went into the text box.
 */
export function createPalette(container, { getMode, editor, textInput, onTextInsert }) {
  container.classList.add('pal');
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Math palette');

  const button = (item, extra = '') =>
    `<button type="button" class="pal-btn ${extra}" data-item="${esc(item.id)}" aria-label="${esc(item.label)}" title="${esc(item.tip)}" tabindex="-1">${item.glyph}</button>`;

  const byId = new Map();
  let html = '';
  for (const group of GROUPS) {
    html += `<div class="pal-group" role="group" aria-label="${group.label}">`;
    for (const item of group.items) {
      byId.set(`${group.id}:${item.id}`, item);
      html += button({ ...item, id: `${group.id}:${item.id}` });
    }
    if (group.more) {
      html += `<button type="button" class="pal-btn pal-more" data-pop="${group.more.id}" aria-haspopup="true" aria-expanded="false" aria-label="${group.more.label}" title="${group.more.label}" tabindex="-1"><span>${group.more.toggle}</span><span class="pal-caret" aria-hidden="true">▾</span></button>`;
    }
    html += '</div>';
  }
  const pops = GROUPS.filter((g) => g.more).map((g) => g.more);
  html += pops
    .map(
      (p) =>
        `<div class="pal-pop" id="pop-${p.id}" role="group" aria-label="${p.label}" hidden style="--cols:${p.cols}">${p.items
          .map((it) => {
            byId.set(`${p.id}:${it.id}`, it);
            return button({ ...it, id: `${p.id}:${it.id}` }, 'pal-pbtn');
          })
          .join('')}</div>`,
    )
    .join('');
  container.innerHTML = html;
  // popovers live on <body>: the toolbar scrolls (clipping) and its ancestors may contain fixed boxes
  const popEls = new Map();
  for (const pop of container.querySelectorAll('.pal-pop')) {
    popEls.set(pop.id, pop);
    document.body.append(pop);
  }
  const bar = [...container.querySelectorAll('.pal-group .pal-btn')];
  bar[0].tabIndex = 0;
  let openPop = null; // { pop, toggle }

  // ----------------------------------------------------------------- actions

  function insertText(snippet) {
    const ta = textInput;
    const { selectionStart: a, selectionEnd: b } = ta;
    const r = applySnippet(ta.value, a, b, snippet);
    ta.focus();
    ta.setSelectionRange(r.from, r.to);
    // insertText keeps the browser's undo stack intact; fall back to assigning the value
    let done = false;
    try {
      done = document.execCommand('insertText', false, r.insert) && ta.value === r.value;
    } catch {
      done = false;
    }
    if (!done) ta.value = r.value;
    ta.setSelectionRange(r.start, r.start);
    onTextInsert?.();
  }

  function activate(item, viaKeyboard) {
    if (getMode() === 'visual') {
      item.v(editor);
      if (viaKeyboard || !editor.hasFocus()) editor.focus();
    } else {
      insertText(item.t);
    }
  }

  // ---------------------------------------------------------------- popovers

  function closePop({ focusToggle = false } = {}) {
    if (!openPop) return;
    const { pop, toggle } = openPop;
    pop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    openPop = null;
    if (focusToggle) toggle.focus();
  }

  function showPop(toggle, focusFirst) {
    const pop = popEls.get(`pop-${toggle.dataset.pop}`);
    if (openPop?.pop === pop) return closePop();
    closePop();
    pop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    const r = toggle.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const left = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - pw - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + 6}px`;
    openPop = { pop, toggle };
    if (focusFirst) {
      const first = pop.querySelector('.pal-pbtn');
      first.tabIndex = 0;
      first.focus();
    }
  }

  // ------------------------------------------------------------------ events

  const onMouseDown = (e) => {
    if (e.target.closest('.pal-btn')) e.preventDefault(); // keep focus where it is
  };

  const onClick = (e) => {
    const btn = e.target.closest('.pal-btn');
    if (!btn) return;
    const viaKeyboard = e.detail === 0;
    if (btn.dataset.pop) {
      showPop(btn, viaKeyboard);
      return;
    }
    const item = byId.get(btn.dataset.item);
    if (!item) return;
    closePop();
    activate(item, viaKeyboard);
  };

  const moveRoving = (list, to) => {
    for (const b of list) b.tabIndex = -1;
    list[to].tabIndex = 0;
    list[to].focus();
  };

  const onKeyDown = (e) => {
    const btn = e.target.closest('.pal-btn');
    if (e.key === 'Escape' && openPop) {
      e.preventDefault();
      e.stopPropagation();
      closePop({ focusToggle: true });
      return;
    }
    if (!btn) return;
    const inPop = btn.closest('.pal-pop');
    const list = inPop ? [...inPop.querySelectorAll('.pal-pbtn')] : bar;
    const at = list.indexOf(btn);
    const cols = inPop ? Number(getComputedStyle(inPop).getPropertyValue('--cols')) || 1 : 1;
    let to = at;
    if (e.key === 'ArrowRight') to = (at + 1) % list.length;
    else if (e.key === 'ArrowLeft') to = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else if (inPop && e.key === 'ArrowDown') to = Math.min(list.length - 1, at + cols);
    else if (inPop && e.key === 'ArrowUp') to = Math.max(0, at - cols);
    else if (!inPop && e.key === 'ArrowDown' && btn.dataset.pop) {
      e.preventDefault();
      showPop(btn, true);
      return;
    } else if (inPop && e.key === 'Tab') {
      closePop({ focusToggle: true });
      return;
    } else return;
    e.preventDefault();
    moveRoving(list, to);
  };
  for (const el of [container, ...popEls.values()]) {
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
  }

  const onDocDown = (e) => {
    if (openPop && !openPop.pop.contains(e.target) && !openPop.toggle.contains(e.target))
      closePop();
  };
  document.addEventListener('pointerdown', onDocDown);
  const onDocKey = (e) => {
    if (e.key === 'Escape') closePop();
  };
  document.addEventListener('keydown', onDocKey);
  const onResize = () => closePop();
  window.addEventListener('resize', onResize);
  container.addEventListener('scroll', onResize);
  // keep the roving stop on the button that last had focus
  container.addEventListener('focusin', (e) => {
    const btn = e.target.closest('.pal-group .pal-btn');
    if (!btn) return;
    for (const b of bar) b.tabIndex = b === btn ? 0 : -1;
  });

  return {
    close: closePop,
    destroy() {
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('keydown', onDocKey);
      window.removeEventListener('resize', onResize);
      for (const pop of popEls.values()) pop.remove();
      container.innerHTML = '';
    },
  };
}
