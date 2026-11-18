// DOM view of the visual math editor: renders the MathModel tree as nested spans, draws the caret
// and selection, and turns keyboard / pointer / clipboard events into model commands.
// Design notes live in docs/EDITOR.md. Styles are the .ed-* rules in style.css.
import { MathModel } from './model.js';
import { fnDisplay } from './util.js';

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const RADICAL_PATH = 'M0.5 15 L3 13.2 L6.2 23 L12 0.6';
const BRACE_PATH =
  'M9 1 C5 1 5 4 5 10 L5 40 C5 46 3 50 0.5 50 C3 50 5 54 5 60 L5 90 C5 96 5 99 9 99';
const svg = (path) =>
  `<svg viewBox="0 0 ${path === BRACE_PATH ? '10 100' : '12 24'}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;

// ------------------------------------------------------------------ rendering (tree -> html)

function renderBlock(block, extra = '') {
  const root = block.parent === null;
  if (!block.items.length) {
    return `<span class="ed-block ed-empty ${extra}" data-id="${block.id}">${root ? '' : '<span class="ed-ph"></span>'}</span>`;
  }
  let html = '';
  let prev = null;
  for (const item of block.items) {
    html += renderItem(item, prev);
    prev = item;
  }
  return `<span class="ed-block ${extra}" data-id="${block.id}">${html}</span>`;
}

function renderAtom(atom, prev) {
  let cls = `ed-a ed-k-${atom.cls}`;
  let text = atom.text;
  if (atom.cls === 'op' && (atom.text === '−' || atom.text === '+')) {
    // a sign at the start of a block or after another operator / separator hugs its operand
    if (!prev || (prev.kind === 'atom' && (prev.cls === 'op' || prev.cls === 'punct'))) {
      cls += ' ed-unary';
    }
  }
  if (atom.cls === 'fn') text = fnDisplay(text);
  if (atom.cls === 'greek' && text !== text.toLowerCase()) cls += ' ed-up';
  return `<span class="${cls}" data-id="${atom.id}">${esc(text)}</span>`;
}

function renderItem(item, prev) {
  if (item.kind === 'atom') return renderAtom(item, prev);
  const id = `data-id="${item.id}"`;
  const [b0, b1] = item.blocks;
  switch (item.kind) {
    case 'frac':
      return `<span class="ed-frac" ${id}><span class="ed-num">${renderBlock(b0)}</span><span class="ed-den">${renderBlock(b1)}</span></span>`;
    case 'sup':
      return `<span class="ed-sup" ${id}>${renderBlock(b0)}</span>`;
    case 'sub':
      return `<span class="ed-sub" ${id}>${renderBlock(b0)}</span>`;
    case 'sqrt': {
      const idx = item.index ? `<span class="ed-idx">${renderBlock(item.index)}</span>` : '';
      return (
        `<span class="ed-sqrt" ${id}>${idx}<span class="ed-rt"><span class="ed-rad">${svg(RADICAL_PATH)}</span>` +
        `<span class="ed-rc">${renderBlock(b0)}</span></span></span>`
      );
    }
    case 'paren': {
      const left =
        item.open === '{' ? `<span class="ed-br ed-lbrace">${svg(BRACE_PATH)}</span>` : '';
      const right =
        item.open === '{' ? `<span class="ed-br ed-rbrace">${svg(BRACE_PATH)}</span>` : '';
      return (
        `<span class="ed-paren ed-p${item.open === '{' ? 'c' : item.open === '[' ? 's' : item.open === '|' ? 'a' : 'r'}" ${id}>` +
        `${left || '<span class="ed-br ed-lp"></span>'}<span class="ed-in">${renderBlock(b0)}</span>` +
        `${right || '<span class="ed-br ed-rp"></span>'}</span>`
      );
    }
    case 'bigop':
      return (
        `<span class="ed-bigop" ${id}><span class="ed-lim">${renderBlock(b1)}</span>` +
        `<span class="ed-sym">${item.op === 'prod' ? '∏' : '∑'}</span><span class="ed-lim">${renderBlock(b0)}</span></span>`
      );
    default:
      return '';
  }
}

// ------------------------------------------------------------------------------ the editor

/**
 * Create a visual equation editor inside `container`.
 * Returns { model, el, focus, blur, hasFocus, getLatex, setLatex, insert, isEmpty, clear, destroy }.
 */
export function createEditor(
  container,
  { onChange, onEnter, label = 'Equation', placeholder = 'Type an equation' } = {},
) {
  const model = new MathModel();
  container.classList.add('ed');
  container.setAttribute('role', 'textbox');
  container.setAttribute('aria-label', label);
  container.setAttribute('aria-multiline', 'false');
  container.innerHTML =
    '<div class="ed-scroll"><div class="ed-surface">' +
    '<div class="ed-content"></div><div class="ed-sel" hidden></div><div class="ed-caret"></div>' +
    '<textarea class="ed-input" rows="1" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"></textarea>' +
    '</div></div><div class="ed-hint"></div><div class="ed-live" aria-live="polite"></div>';
  const scroller = container.querySelector('.ed-scroll');
  const surface = container.querySelector('.ed-surface');
  const content = container.querySelector('.ed-content');
  const selEl = container.querySelector('.ed-sel');
  const caretEl = container.querySelector('.ed-caret');
  const input = container.querySelector('.ed-input');
  const hint = container.querySelector('.ed-hint');
  const live = container.querySelector('.ed-live');
  input.setAttribute('aria-label', label);
  hint.textContent = placeholder;
  hint.setAttribute('aria-hidden', 'true');

  let els = new Map();
  let composing = false;
  let liveTimer = 0;
  let pointerType = 'mouse';
  let dragging = false;

  // ---------------------------------------------------------------- geometry

  const rectOf = (id) => els.get(id)?.getBoundingClientRect() ?? null;

  /** Height-giving neighbour: scripts are small and raised, so look past them. */
  function lineItem(block, i, dir) {
    for (let k = i; k >= 0 && k < block.items.length; k += dir) {
      const item = block.items[k];
      if (item.kind !== 'sup' && item.kind !== 'sub') return item;
    }
    return null;
  }

  function caretRect() {
    const { block, index } = model.cursor;
    const sr = surface.getBoundingClientRect();
    const bel = els.get(block.id);
    if (!bel) return null;
    const prev = block.items[index - 1];
    const next = block.items[index];
    let x;
    const rects = [];
    if (prev && next) {
      x = (rectOf(prev.id).right + rectOf(next.id).left) / 2;
    } else if (prev) {
      x = rectOf(prev.id).right;
    } else if (next) {
      x = rectOf(next.id).left;
    }
    const a = lineItem(block, index - 1, -1);
    const b = lineItem(block, index, 1);
    if (a) rects.push(rectOf(a.id));
    if (b) rects.push(rectOf(b.id));
    if (!rects.length) {
      const ph = bel.querySelector(':scope > .ed-ph');
      const r = (ph ?? bel).getBoundingClientRect();
      if (x === undefined) x = ph ? (r.left + r.right) / 2 : r.left;
      rects.push(r);
    }
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: x - sr.left, top: top - sr.top, height: bottom - top };
  }

  function drawOverlays() {
    const c = caretRect();
    const sel = model.selection;
    const sr = surface.getBoundingClientRect();
    if (c) {
      caretEl.style.left = `${c.x - 0.75}px`;
      caretEl.style.top = `${c.top}px`;
      caretEl.style.height = `${c.height}px`;
      input.style.left = `${c.x}px`;
      input.style.top = `${c.top}px`;
      input.style.height = `${c.height}px`;
    }
    caretEl.hidden = !!sel;
    caretEl.style.animation = 'none';
    void caretEl.offsetWidth;
    caretEl.style.animation = '';
    if (sel) {
      const rs = sel.block.items
        .slice(sel.start, sel.end)
        .map((it) => rectOf(it.id))
        .filter(Boolean);
      if (rs.length) {
        const left = Math.min(...rs.map((r) => r.left));
        const right = Math.max(...rs.map((r) => r.right));
        const top = Math.min(...rs.map((r) => r.top));
        const bottom = Math.max(...rs.map((r) => r.bottom));
        Object.assign(selEl.style, {
          left: `${left - sr.left - 1}px`,
          top: `${top - sr.top}px`,
          width: `${right - left + 2}px`,
          height: `${bottom - top}px`,
        });
        selEl.hidden = false;
      } else {
        selEl.hidden = true;
      }
    } else {
      selEl.hidden = true;
    }
    if (c && container.classList.contains('ed-focused')) {
      const view = scroller.getBoundingClientRect();
      const abs = sr.left + c.x;
      if (abs > view.right - 12) scroller.scrollLeft += abs - view.right + 24;
      else if (abs < view.left + 12) scroller.scrollLeft -= view.left - abs + 24;
    }
  }

  /** An exponent after a tall bracket / fraction / root sits at its top corner, not mid-height. */
  function raiseScripts() {
    for (const sup of content.querySelectorAll('.ed-sup')) {
      const prev = sup.previousElementSibling;
      if (!prev || !/\bed-(paren|frac|sqrt|bigop)\b/.test(prev.className)) continue;
      const em = parseFloat(getComputedStyle(sup).fontSize) / 0.7;
      const h = prev.getBoundingClientRect().height;
      if (h > 1.5 * em) sup.style.verticalAlign = `${(h / 2 - 0.25 * em).toFixed(1)}px`;
    }
  }

  function render() {
    content.innerHTML = renderBlock(model.root, 'ed-root');
    els = new Map();
    for (const el of content.querySelectorAll('[data-id]')) els.set(el.dataset.id, el);
    raiseScripts();
    container.classList.toggle('ed-blank', model.isEmpty());
    drawOverlays();
  }

  function scheduleLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      live.textContent = model.isEmpty() ? 'Empty equation' : `LaTeX: ${model.getLatex()}`;
    }, 400);
  }

  const unsubscribe = model.onChange((m, info) => {
    render();
    if (info.content) scheduleLive();
    onChange?.(m, info);
  });

  // ------------------------------------------------------------ hit testing

  function positionAt(x, y) {
    let best = null;
    for (const el of content.querySelectorAll('.ed-block')) {
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const score = Math.max(0, Math.hypot(dx, dy) - 4);
      const area = r.width * r.height;
      if (
        !best ||
        score < best.score - 0.01 ||
        (Math.abs(score - best.score) <= 0.01 && area < best.area)
      ) {
        best = { id: el.dataset.id, score, area };
      }
    }
    if (!best) return null;
    const block = model.find(best.id);
    if (!block) return null;
    let index = block.items.length;
    for (let i = 0; i < block.items.length; i++) {
      const r = rectOf(block.items[i].id);
      if (r && x < (r.left + r.right) / 2) {
        index = i;
        break;
      }
    }
    return { block, index };
  }

  function place(e, extend) {
    const pos = positionAt(e.clientX, e.clientY);
    if (pos) model.setCursor(pos.block.id, pos.index, { extend });
  }

  function focusInput() {
    input.focus({ preventScroll: true });
  }

  const onPointerDown = (e) => {
    pointerType = e.pointerType || 'mouse';
    if (e.button !== 0 || pointerType === 'touch') return;
    e.preventDefault();
    focusInput();
    place(e, e.shiftKey);
    dragging = true;
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      // capture is best effort
    }
  };
  const onPointerMove = (e) => {
    if (dragging) place(e, true);
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onClick = (e) => {
    // touch / pen taps arrive here so the soft keyboard may open
    if (pointerType === 'touch') {
      focusInput();
      place(e, false);
    } else if (!container.classList.contains('ed-focused')) {
      focusInput();
    }
  };
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('click', onClick);

  // --------------------------------------------------------------- keyboard

  const NAV = {
    ArrowLeft: 'moveLeft',
    ArrowRight: 'moveRight',
    ArrowUp: 'moveUp',
    ArrowDown: 'moveDown',
    Home: 'home',
    End: 'end',
  };

  const onKeyDown = (e) => {
    if (composing || e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        model.selectAll();
      } else if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) model.redo();
        else model.undo();
      } else if (k === 'y') {
        e.preventDefault();
        model.redo();
      } else if (NAV[e.key]) {
        e.preventDefault();
        model[NAV[e.key]]({ shift: e.shiftKey });
      }
      return; // c / x / v go through the clipboard events
    }
    if (NAV[e.key]) {
      e.preventDefault();
      model[NAV[e.key]]({ shift: e.shiftKey });
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      model.backspace();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      model.del();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      model.commitWord();
      onEnter?.();
    }
  };

  const flushInput = () => {
    const text = input.value.replace(/[\r\n]+/g, '');
    input.value = '';
    if (text) model.typeText(text);
  };
  const onInput = (e) => {
    if (composing || e.isComposing) return;
    flushInput();
  };
  const onBeforeInput = (e) => {
    // soft keyboards report Backspace here when the (empty) textarea gives no keydown
    if (e.inputType === 'deleteContentBackward' && input.value === '') {
      e.preventDefault();
      model.backspace();
    } else if (e.inputType === 'deleteContentForward' && input.value === '') {
      e.preventDefault();
      model.del();
    }
  };
  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = () => {
    composing = false;
    flushInput();
  };
  const onCopy = (e) => {
    const text = model.selection ? model.getSelectionLatex() : model.getLatex();
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  };
  const onCut = (e) => {
    onCopy(e);
    if (model.selection) model.backspace();
  };
  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) model.paste(text.replace(/[\r\n]+/g, ' ').trim());
  };
  const onFocus = () => {
    container.classList.add('ed-focused');
    drawOverlays();
  };
  const onBlur = () => {
    container.classList.remove('ed-focused');
    dragging = false;
    model.commitWord();
  };
  const listeners = [
    ['keydown', onKeyDown],
    ['input', onInput],
    ['beforeinput', onBeforeInput],
    ['compositionstart', onCompositionStart],
    ['compositionend', onCompositionEnd],
    ['copy', onCopy],
    ['cut', onCut],
    ['paste', onPaste],
    ['focus', onFocus],
    ['blur', onBlur],
  ];
  for (const [type, fn] of listeners) input.addEventListener(type, fn);

  const onResize = () => drawOverlays();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  observer?.observe(container);
  document.fonts?.ready.then(drawOverlays);

  render();

  return {
    model,
    el: container,
    focus: focusInput,
    blur: () => input.blur(),
    hasFocus: () => document.activeElement === input,
    getLatex: () => model.getLatex(),
    setLatex: (src, opts = { resetHistory: true }) => model.setLatex(src, opts),
    insert: (kind, options) => model.insert(kind, options),
    isEmpty: () => model.isEmpty(),
    clear: () => model.clear(),
    refresh: render,
    destroy() {
      clearTimeout(liveTimer);
      unsubscribe();
      observer?.disconnect();
      for (const [type, fn] of listeners) input.removeEventListener(type, fn);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('click', onClick);
      container.innerHTML = '';
    },
  };
}
