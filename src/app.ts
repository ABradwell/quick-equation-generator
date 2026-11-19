import { parseEquation, parseExpression, ParseError } from './lib/parser.ts';
import { evaluate } from './lib/evaluate.ts';
import { LANGUAGES } from './lib/generators/index.ts';
import { renderDefinition, renderIdentifier, escapeHtml as esc } from './lib/render.ts';
import { highlight } from './lib/highlight.ts';
import { createEditor } from './lib/editor/view.ts';
import type { Editor } from './lib/editor/view.ts';
import type { Definition } from './lib/ast.ts';
import { createPalette } from './lib/editor/palette.ts';
import { isIncomplete } from './lib/editor/util.ts';
import { createGraph, createContour, iterationCost, fmtValue } from './lib/graph.ts';

const HISTORY_KEY = 'equation-converter:history';
const LANG_KEY = 'equation-converter:language';
const MODE_KEY = 'equation-converter:mode';
const HISTORY_MAX = 50;
const SAVE_DELAY_MS = 1000;
const DEFAULT_EQUATION = 'f(x) = x^2 + 2x + 1';
const MAX_LIVE_COST = 5e4; // loop iterations per evaluation allowed for the graph
const MAX_EVAL_COST = 2e6; // same, for the single-value evaluator

const EXAMPLES = [
  'f(x) = x^2 + 2x + 1',
  'g(t) = e^{-t^2/2}/\\sqrt{2\\pi}',
  '\\sum_{n=1}^{N} \\frac{1}{n^2}',
  'p(x) = {x<0: -x, x<2: x^2, 1}',
  'x^2 + y^2 = 1',
  'area(r) = \\pi r^2',
  'θ = atan2(y, x)',
];

type Mode = 'visual' | 'text';
type LangKey = keyof typeof LANGUAGES;
type VizMode = 'graph' | 'contour' | 'eval';

interface Viz {
  mode?: VizMode;
  update: (def: Definition) => void;
  redraw: () => void;
  destroy: () => void;
}

/** Every element below is in index.html, so a missing one is a programming error. */
const $ = <E extends HTMLElement = HTMLElement>(selector: string): E =>
  document.querySelector<E>(selector)!;
const els = {
  entry: $('.entry'),
  editorHost: $('#editor'),
  fieldVisual: $('#field-visual'),
  fieldText: $('#field-text'),
  modeSwitch: $('#mode'),
  palette: $('#palette'),
  signature: $('#signature'),
  notice: $('#notice'),
  input: $<HTMLInputElement>('#eq'),
  mirror: $('#mirror-text'),
  preview: $('#preview'),
  status: $('#status'),
  tabs: $('#tabs'),
  code: $('#code'),
  copy: $<HTMLButtonElement>('#copy'),
  vizTitle: $('#viz-title'),
  vizNote: $('#viz-note'),
  vizBody: $('#viz-body'),
  vizCard: $('.viz-card'),
  codeCard: $('.code-card'),
  history: $('#history'),
  clear: $<HTMLButtonElement>('#clear-history'),
  examples: $('#examples'),
};

/** The element an event came from, narrowed to the closest match of `selector`. */
const closest = (e: Event, selector: string): HTMLElement | null =>
  (e.target as Element).closest<HTMLElement>(selector);

// ------------------------------------------------------------------ storage

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // storage unavailable or full: the app still works without persistence
    }
  },
};

const state: {
  def: Definition | null;
  ok: boolean;
  okRaw: string;
  lang: LangKey;
  codeText: string;
  history: string[];
  mode: Mode;
  alias: Map<string, string>;
} = {
  def: null,
  ok: false,
  okRaw: '',
  lang: 'python',
  codeText: '',
  history: loadHistory(),
  mode: store.get(MODE_KEY) === 'text' ? 'text' : 'visual',
  alias: new Map(), // normalised LaTeX from the editor -> the string it was loaded from
};
// Assigned once below, before anything reads it.
let editor: Editor = null!;
let loading = false; // true while code (not the user) fills the editor

/** The equation as a source string, whichever input mode is active. */
const getSource = () => (state.mode === 'visual' && editor ? editor.getLatex() : els.input.value);

const savedLang = store.get(LANG_KEY);
if (savedLang && Object.hasOwn(LANGUAGES, savedLang)) state.lang = savedLang as LangKey;

function loadHistory(): string[] {
  try {
    const list: unknown = JSON.parse(store.get(HISTORY_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function persistHistory() {
  store.set(HISTORY_KEY, JSON.stringify(state.history));
}

function remember(src: string): void {
  const text = (state.alias.get(src.trim()) ?? src).trim();
  if (!text) return;
  state.history = [text, ...state.history.filter((h) => h !== text)].slice(0, HISTORY_MAX);
  persistHistory();
  renderHistory();
}

// ----------------------------------------- error positions in the raw input

const GREEK_NAMES: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  θ: 'theta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  ρ: 'rho',
  σ: 'sigma',
  υ: 'upsilon',
  φ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Γ: 'Gamma',
  Δ: 'Delta',
  Θ: 'Theta',
  Λ: 'Lambda',
  Ξ: 'Xi',
  Σ: 'Sigma',
  Φ: 'Phi',
  Ψ: 'Psi',
  Ω: 'Omega',
};

interface NormalizedText {
  text: string;
  /** map[i] is the index in the raw input of normalised character i. */
  map: number[];
}

/**
 * The parser normalises its input (drops \left/\right, spells out Greek letters, trims), so error
 * positions refer to the normalised text. Do the same normalisation here while remembering where
 * every character came from, so a position can be mapped back onto what the user typed.
 */
function normalizeWithMap(raw: string): NormalizedText {
  let text = raw;
  let map = Array.from({ length: raw.length }, (_, i) => i);
  const replace = (re: RegExp, fn: (m: RegExpExecArray) => string): void => {
    let out = '';
    const outMap: number[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += text.slice(last, m.index);
      outMap.push(...map.slice(last, m.index));
      const rep = fn(m);
      out += rep;
      for (let k = 0; k < rep.length; k++) outMap.push(map[m.index]);
      last = m.index + m[0].length;
    }
    out += text.slice(last);
    outMap.push(...map.slice(last));
    text = out;
    map = outMap;
  };
  replace(/\\(left|right)(?![A-Za-z])/g, () => '');
  replace(/[Ͱ-Ͽ]/g, (m) => (m[0] in GREEK_NAMES ? `\\${GREEK_NAMES[m[0]]} ` : m[0]));
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return { text: trimmed, map: map.slice(lead, lead + trimmed.length) };
}

// ------------------------------------------------------------------ preview

function syncMirror() {
  els.mirror.style.transform = `translateX(${-els.input.scrollLeft}px)`;
}

function setMirror(idx: number | null): void {
  const raw = els.input.value;
  if (idx === null || state.mode !== 'text') {
    els.mirror.textContent = '';
  } else {
    const at = Math.min(idx, raw.length);
    const ch = raw[at] ?? ' ';
    els.mirror.innerHTML = `${esc(raw.slice(0, at))}<mark>${esc(ch)}</mark>${esc(raw.slice(at + 1))}`;
  }
  syncMirror();
}

function setStale(stale: boolean): void {
  els.preview.classList.toggle('stale', stale);
  els.signature.classList.toggle('stale', stale);
  els.codeCard.classList.toggle('stale', stale);
  els.vizCard.classList.toggle('stale', stale);
}

/** 'ok', 'soft' (still typing: calm) or 'bad' (a real error). */
function setValidity(v: 'ok' | 'soft' | 'bad'): void {
  for (const el of [els.input, els.editorHost]) {
    if (v === 'bad') el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
  els.editorHost.classList.toggle('ed-soft', v === 'soft');
}

const SIGNATURE_KIND: Record<Definition['kind'], string> = {
  function: 'function',
  assignment: 'constant',
  implicit: 'implicit curve',
  expression: 'expression',
};

/** Visual mode shows what the equation turns into instead of a second typeset copy. */
function renderSignature(def: Definition): void {
  const name = renderIdentifier(def.name);
  const params = def.params.map(renderIdentifier).join('<span class="m-comma">,</span> ');
  const lhs = def.params.length
    ? `${name}<span class="m-p">(</span>${params}<span class="m-p">)</span>`
    : name;
  let kind: string = SIGNATURE_KIND[def.kind] ?? def.kind;
  if (def.kind === 'implicit') kind += ' · returns left − right';
  else if (def.params.length) kind += ` of ${def.params.join(', ')}`;
  els.signature.innerHTML =
    `<span class="sig-lead">Becomes</span><span class="m-math">${lhs}</span>` +
    `<span class="sig-badge">${esc(kind)}</span>`;
}

function setEmpty() {
  state.def = null;
  state.ok = false;
  setValidity('ok');
  els.signature.innerHTML = '';
  setMirror(null);
  setStale(false);
  els.preview.innerHTML = '<span class="hint">Your typeset equation appears here.</span>';
  els.status.textContent = '';
  els.code.innerHTML = '<span class="empty">Generated code appears here.</span>';
  state.codeText = '';
  els.copy.disabled = true;
  destroyViz();
  els.vizTitle.textContent = 'Graph';
  els.vizNote.textContent = '';
  els.vizBody.innerHTML = '';
}

function showError(err: Error, raw: string, norm: NormalizedText): void {
  state.ok = false;
  if (state.mode === 'visual') {
    // empty slots or an expression that just stops short: the user is still typing
    const soft = isIncomplete(editor.model.root) || /end of input/.test(err.message);
    setValidity(soft ? 'soft' : 'bad');
    els.status.innerHTML = soft
      ? '<span class="soft">Keep typing…</span>'
      : `<span class="err">${esc(err.message)}</span>`;
    if (state.def) setStale(true);
    return;
  }
  setValidity('bad');
  let idx: number | null = null;
  if (err instanceof ParseError && err.pos >= 0) idx = norm.map[err.pos] ?? raw.length;
  setMirror(idx);
  const where = idx === null ? '' : `<span class="err-pos">at character ${idx + 1}</span>`;
  els.status.innerHTML = `<span class="err">${esc(err.message)}</span>${where}`;
  if (state.def) setStale(true);
}

function showWarnings(warnings: string[]): void {
  els.status.innerHTML = warnings.map((w) => `<span class="warn">${esc(w)}</span>`).join('');
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.ok && state.okRaw === getSource()) remember(getSource());
  }, SAVE_DELAY_MS);
}

function update({ save = true }: { save?: boolean } = {}): void {
  const raw = getSource();
  if (!raw.trim()) {
    clearTimeout(saveTimer);
    setEmpty();
    renderHistory();
    return;
  }
  const norm = normalizeWithMap(raw);
  let def;
  try {
    def = parseEquation(norm.text);
  } catch (err) {
    showError(err as Error, raw, norm);
    return;
  }
  state.def = def;
  state.ok = true;
  state.okRaw = raw;
  setValidity('ok');
  setMirror(null);
  setStale(false);
  els.preview.innerHTML = renderDefinition(def);
  renderSignature(def);
  showWarnings(def.warnings);
  renderCode();
  renderViz();
  renderHistory();
  if (save) scheduleSave();
}

// --------------------------------------------------------------------- code

function renderTabs() {
  els.tabs.innerHTML = '';
  for (const [key, lang] of Object.entries(LANGUAGES)) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.id = `tab-${key}`;
    tab.dataset.lang = key;
    tab.textContent = lang.label;
    els.tabs.append(tab);
  }
  syncTabs();
}

function syncTabs() {
  for (const tab of els.tabs.children as HTMLCollectionOf<HTMLElement>) {
    const on = tab.dataset.lang === state.lang;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
}

function setLang(key: LangKey): void {
  state.lang = key;
  store.set(LANG_KEY, key);
  syncTabs();
  if (state.def) renderCode();
}

function renderCode() {
  const lang = LANGUAGES[state.lang];
  try {
    const text = String(lang.generate(state.def!) ?? '');
    state.codeText = text;
    els.code.innerHTML = highlight(text, state.lang);
    els.copy.disabled = !text;
  } catch (err) {
    state.codeText = '';
    els.code.innerHTML = `<span class="code-err">Could not generate ${esc(lang.label)} code: ${esc(err instanceof Error ? err.message : String(err))}</span>`;
    els.copy.disabled = true;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path (insecure origins, denied permission)
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

let copyTimer: ReturnType<typeof setTimeout> | undefined;
async function onCopy() {
  if (!state.codeText) return;
  const ok = await copyText(state.codeText);
  els.copy.textContent = ok ? 'Copied' : 'Copy failed';
  els.copy.classList.toggle('done', ok);
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    els.copy.textContent = 'Copy';
    els.copy.classList.remove('done');
  }, 1600);
  if (ok && state.ok && state.okRaw === getSource()) remember(getSource());
}

// ---------------------------------------------------------------------- viz

let viz: Viz | null = null;

function destroyViz() {
  viz?.destroy();
  viz = null;
}

function pickMode(def: Definition): VizMode {
  if (def.params.length === 1) return 'graph';
  if (def.params.length === 2 && def.kind === 'implicit') return 'contour';
  return 'eval';
}

function renderViz() {
  const def = state.def!;
  const mode = pickMode(def);
  if (!viz || viz.mode !== mode) {
    destroyViz();
    viz = { graph: makeGraph, contour: makeContour, eval: makeEval }[mode]();
    viz.mode = mode;
  }
  viz.update(def);
}

const HEAVY = 'Too many terms to plot live.';

function makeGraph(): Viz {
  els.vizTitle.textContent = 'Graph';
  els.vizNote.textContent = 'x from −10 to 10';
  els.vizBody.innerHTML =
    '<canvas class="plot" aria-label="Graph of the function"></canvas><div class="readout" aria-hidden="true"></div>';
  const graph = createGraph(
    els.vizBody.querySelector('canvas')!,
    els.vizBody.querySelector<HTMLElement>('.readout')!,
  );
  return {
    update(def: Definition) {
      const cost = Math.max(
        ...[-10, 0, 10].map((x) => iterationCost(def.body, { [def.params[0]]: x })),
      );
      graph.setDef(def, cost > MAX_LIVE_COST ? HEAVY : '');
    },
    redraw: graph.redraw,
    destroy: graph.destroy,
  };
}

function makeContour(): Viz {
  els.vizTitle.textContent = 'Curve';
  els.vizNote.textContent = 'where the expression equals 0';
  els.vizBody.innerHTML =
    '<canvas class="plot" aria-label="Zero contour of the equation"></canvas>' +
    '<label class="zoom">Zoom<input type="range" min="-1" max="2" step="0.05" value="1" aria-label="Plot range"></label>';
  const slider = els.vizBody.querySelector('input')!;
  const contour = createContour(els.vizBody.querySelector('canvas')!);
  contour.setRange(10 ** Number(slider.value));
  slider.addEventListener('input', () => contour.setRange(10 ** Number(slider.value)));
  return {
    update(def: Definition) {
      const env = { [def.params[0]]: 0, [def.params[1]]: 0 };
      contour.setDef(def, iterationCost(def.body, env) > MAX_LIVE_COST / 20 ? HEAVY : '');
    },
    redraw: contour.redraw,
    destroy: contour.destroy,
  };
}

function makeEval(): Viz {
  els.vizTitle.textContent = 'Evaluate';
  els.vizNote.textContent = '';
  const values = new Map<string, string>();
  let signature: string | null = null;
  let currentDef: Definition | null = null;

  const compute = () => {
    const def = currentDef!;
    const out = els.vizBody.querySelector<HTMLElement>('.ev-result')!;
    const env: Record<string, number> = {};
    for (const input of els.vizBody.querySelectorAll('input')) {
      const name = input.dataset.param!;
      values.set(name, input.value);
      let bad = false;
      try {
        env[name] = input.value.trim() ? evaluate(parseExpression(input.value), {}) : NaN;
        bad = Number.isNaN(env[name]);
      } catch {
        bad = true;
      }
      input.setAttribute('aria-invalid', String(bad));
      if (bad) {
        out.innerHTML = `<span class="ev-msg">Enter a number for ${renderIdentifier(name)}.</span>`;
        return;
      }
    }
    if (iterationCost(def.body, env) > MAX_EVAL_COST) {
      out.innerHTML = '<span class="ev-msg">That sum has too many terms to evaluate here.</span>';
      return;
    }
    let result: number;
    try {
      result = Number(evaluate(def.body, env));
    } catch (err) {
      out.innerHTML = `<span class="ev-msg">${esc((err as Error).message)}</span>`;
      return;
    }
    const args = def.params.map((p) => fmtValue(env[p])).join(', ');
    const lhs = def.params.length
      ? `${renderIdentifier(def.name)}(${esc(args)})`
      : renderIdentifier(def.name);
    const note = Number.isNaN(result) ? ' <span class="ev-msg">(undefined)</span>' : '';
    out.innerHTML = `<span class="m-math">${lhs} = <b>${esc(fmtValue(result))}</b></span>${note}`;
  };

  els.vizBody.addEventListener('input', compute);

  return {
    update(def: Definition) {
      currentDef = def;
      const sig = def.params.join('|');
      if (sig !== signature) {
        signature = sig;
        const rows = def.params
          .map(
            (p) =>
              `<label class="ev-row"><span class="ev-name m-math">${renderIdentifier(p)}</span>` +
              `<input data-param="${esc(p)}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(values.get(p) ?? '1')}" aria-label="Value of ${esc(p)}"></label>`,
          )
          .join('');
        els.vizBody.innerHTML = `<div class="eval">${rows}<div class="ev-result" aria-live="polite"></div></div>`;
      }
      els.vizNote.textContent = def.params.length ? 'try some values' : '';
      compute();
    },
    redraw() {},
    destroy() {
      els.vizBody.removeEventListener('input', compute);
    },
  };
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viz?.redraw());

// ------------------------------------------------------------------ history

const typesetCache = new Map<string, string>();
function typeset(src: string): string {
  if (!typesetCache.has(src)) {
    let html = '';
    try {
      html = renderDefinition(parseEquation(normalizeWithMap(src).text));
    } catch {
      html = '';
    }
    typesetCache.set(src, html);
  }
  return typesetCache.get(src)!;
}

function renderHistory() {
  if (!state.history.length) {
    els.history.innerHTML = '<li class="empty">Equations you finish typing show up here.</li>';
    els.clear.disabled = true;
    return;
  }
  els.clear.disabled = false;
  const current = getSource().trim();
  els.history.innerHTML = state.history
    .map((src, i) => {
      const math = typeset(src);
      return (
        `<li class="hi${src === current || state.alias.get(current) === src ? ' current' : ''}">` +
        `<button type="button" class="hi-pick" data-i="${i}" title="${esc(src)}">` +
        (math ? `<span class="hi-math">${math}</span>` : '') +
        `<span class="hi-raw">${esc(src)}</span></button>` +
        `<button type="button" class="hi-del" data-del="${i}" aria-label="Delete ${esc(src)} from history">×</button></li>`
      );
    })
    .join('');
}

function showNotice(message: string): void {
  clearTimeout(noticeTimer);
  els.notice.textContent = message;
  els.notice.hidden = !message;
  if (message) noticeTimer = setTimeout(() => showNotice(''), 7000);
}
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Fill the visual editor from a string; false if it cannot be represented there. */
function loadVisual(src: string): boolean {
  loading = true;
  let result: ReturnType<Editor['setLatex']>;
  try {
    result = editor.setLatex(src);
  } finally {
    loading = false;
  }
  if (!result.ok) return false;
  const latex = editor.getLatex();
  if (latex !== src.trim()) state.alias.set(latex, src.trim());
  return true;
}

function setEquation(src: string): void {
  if (state.mode === 'visual') {
    if (loadVisual(src)) {
      update();
      editor.focus();
      return;
    }
    els.input.value = src;
    applyMode('text', false);
    showNotice('That equation cannot be shown in the visual editor, so it opened in Text mode.');
    return;
  }
  els.input.value = src;
  update();
  els.input.focus();
  els.input.setSelectionRange(src.length, src.length);
}

function applyMode(mode: Mode, persist = true): void {
  state.mode = mode;
  if (persist) store.set(MODE_KEY, mode);
  els.entry.dataset.mode = mode;
  els.fieldVisual.hidden = mode !== 'visual';
  els.fieldText.hidden = mode !== 'text';
  for (const b of els.modeSwitch.children as HTMLCollectionOf<HTMLElement>) {
    const on = b.dataset.mode === mode;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  update({ save: false });
}

function switchMode(mode: Mode): void {
  if (mode === state.mode) return;
  showNotice('');
  if (mode === 'text') {
    editor.model.commitWord();
    els.input.value = editor.getLatex();
    applyMode('text');
    els.input.focus();
    els.input.setSelectionRange(els.input.value.length, els.input.value.length);
    return;
  }
  const src = els.input.value;
  if (!src.trim()) {
    loading = true;
    editor.clear();
    loading = false;
  } else if (!loadVisual(src)) {
    showNotice('That equation cannot be shown in the visual editor yet, so it stays in Text mode.');
    return;
  }
  applyMode('visual');
  editor.focus();
}

els.history.addEventListener('click', (e) => {
  const del = closest(e, '[data-del]');
  if (del) {
    state.history.splice(Number(del.dataset.del), 1);
    persistHistory();
    renderHistory();
    return;
  }
  const pick = closest(e, '[data-i]');
  if (pick) setEquation(state.history[Number(pick.dataset.i)]);
});

els.history.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const picks = [...els.history.querySelectorAll<HTMLElement>('.hi-pick')];
  const at = picks.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  picks[Math.max(0, Math.min(picks.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
});

els.clear.addEventListener('click', () => {
  state.history = [];
  persistHistory();
  renderHistory();
});

// -------------------------------------------------------------------- wiring

function renderExamples() {
  els.examples.innerHTML = EXAMPLES.map((src) => {
    const math = typeset(src);
    return (
      `<button type="button" class="ex" data-src="${esc(src)}">` +
      (math ? `<span class="ex-math">${math}</span>` : '') +
      `<span class="ex-raw">${esc(src)}</span></button>`
    );
  }).join('');
}

els.examples.addEventListener('click', (e) => {
  const ex = closest(e, '[data-src]');
  if (ex) setEquation(ex.dataset.src!);
});

els.tabs.addEventListener('click', (e) => {
  const tab = closest(e, '[data-lang]');
  if (tab) setLang(tab.dataset.lang as LangKey);
});

els.tabs.addEventListener('keydown', (e) => {
  const keys = Object.keys(LANGUAGES) as LangKey[];
  let i = keys.indexOf(state.lang);
  if (e.key === 'ArrowRight') i = (i + 1) % keys.length;
  else if (e.key === 'ArrowLeft') i = (i - 1 + keys.length) % keys.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = keys.length - 1;
  else return;
  e.preventDefault();
  setLang(keys[i]);
  (els.tabs.children[i] as HTMLElement).focus();
});

els.copy.addEventListener('click', onCopy);

els.input.addEventListener('input', () => {
  update();
  requestAnimationFrame(syncMirror);
});
for (const type of ['keyup', 'click', 'select', 'focus']) {
  els.input.addEventListener(type, () => requestAnimationFrame(syncMirror));
}
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (state.ok) remember(els.input.value);
  }
});

els.modeSwitch.addEventListener('click', (e) => {
  const b = closest(e, '[data-mode]');
  if (b) switchMode(b.dataset.mode as Mode);
});
els.modeSwitch.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const next = state.mode === 'visual' ? 'text' : 'visual';
  switchMode(next);
  els.modeSwitch.querySelector<HTMLElement>(`[data-mode="${state.mode}"]`)!.focus();
});

editor = createEditor(els.editorHost, {
  label: 'Equation',
  placeholder: 'Type an equation, e.g. x^2 + 1, or press / for a fraction',
  onChange(_model, info) {
    if (info.content && !loading) update();
  },
  onEnter() {
    if (state.ok) remember(getSource());
  },
});
(window as Window & { __editor?: Editor }).__editor = editor;
createPalette(els.palette, {
  getMode: () => state.mode,
  editor,
  textInput: els.input,
  onTextInsert: () => els.input.dispatchEvent(new Event('input', { bubbles: true })),
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
    e.preventDefault();
    if (state.mode === 'visual') {
      editor.focus();
    } else {
      els.input.focus();
      els.input.select();
    }
  }
});

renderTabs();
renderExamples();
{
  const start = state.history[0] ?? DEFAULT_EQUATION;
  els.input.value = start;
  if (state.mode === 'visual' && !loadVisual(start)) state.mode = 'text';
  applyMode(state.mode, false);
  if (state.mode === 'visual') {
    editor.focus();
  } else {
    els.input.focus();
    els.input.select();
  }
}
