// The physics notebook panel: a searchable library of pre-baked equations plus the user's own.

import { escapeHtml as esc, renderIdentifier } from '../render.ts';
import { NOTEBOOK } from './data.ts';
import type { NotebookEntry } from './data.ts';
import { addSaved, formatInput, matches, parseSaved, searchText } from './model.ts';
import type { SavedEntry } from './model.ts';

export interface NotebookOptions {
  /** Typeset an equation source as HTML ('' if it does not parse). */
  typeset: (src: string) => string;
  /** Load an equation into the editor, with inputs to preload into the Evaluate panel. */
  onPick: (src: string, values?: Record<string, string>) => void;
  /** The equation in the editor if it currently parses, with its Evaluate inputs. */
  current: () => { src: string; name: string; values: Record<string, string> } | null;
  /** True when `src` is the equation in the editor. */
  isCurrent: (src: string) => boolean;
  /** Read and write the saved list (JSON). */
  load: () => string | null;
  save: (raw: string) => void;
}

export interface Notebook {
  /** Re-mark the current equation and the Save button after the editor changes. */
  refresh: () => void;
}

const ALL = 'all';
const SAVED = 'saved';
const TOTAL = NOTEBOOK.reduce((n, t) => n + t.entries.length, 0);

const SEARCH_INDEX = new Map<NotebookEntry, string>(
  NOTEBOOK.flatMap((t) => t.entries.map((e) => [e, searchText(e, t.title)] as const)),
);
const BY_ID = new Map(NOTEBOOK.flatMap((t) => t.entries.map((e) => [e.id, e] as const)));

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function createNotebook(host: HTMLElement, opts: NotebookOptions): Notebook {
  let saved: SavedEntry[] = parseSaved(opts.load());
  let filter = ALL;
  let query = '';

  host.innerHTML =
    '<div class="card-head">' +
    '<h2 class="card-title" id="nb-title">Physics notebook</h2>' +
    `<span class="card-note">${TOTAL} equations</span>` +
    '</div>' +
    '<p class="nb-lead">Pre-built equations for motion, gravity, orbits, propulsion, reentry, ' +
    'relativity and radiation. Choose one to load it with worked example values.</p>' +
    '<div class="nb-tools">' +
    '<input type="search" class="nb-search" placeholder="Search, e.g. escape, thrust, Hohmann" ' +
    'aria-label="Search the notebook" autocomplete="off" spellcheck="false">' +
    '<button type="button" class="btn nb-save-open">Save current equation</button>' +
    '</div>' +
    '<form class="nb-save" hidden>' +
    '<label class="nb-save-label">Name<input class="nb-save-name" maxlength="80" ' +
    'autocomplete="off" spellcheck="false"></label>' +
    '<button type="submit" class="btn">Save</button>' +
    '<button type="button" class="btn btn-quiet nb-save-cancel">Cancel</button>' +
    '</form>' +
    '<div class="nb-filters" role="group" aria-label="Filter by topic"></div>' +
    '<div class="nb-list" aria-live="polite"></div>';

  const q = <E extends HTMLElement>(sel: string) => host.querySelector<E>(sel)!;
  const search = q<HTMLInputElement>('.nb-search');
  const saveOpen = q<HTMLButtonElement>('.nb-save-open');
  const form = q<HTMLFormElement>('.nb-save');
  const nameInput = q<HTMLInputElement>('.nb-save-name');
  const filters = q('.nb-filters');
  const list = q('.nb-list');

  const persist = () => opts.save(JSON.stringify(saved));

  function renderFilters() {
    const chips = [
      { id: ALL, label: 'All' },
      { id: SAVED, label: `My equations${saved.length ? ` (${saved.length})` : ''}` },
      ...NOTEBOOK.map((t) => ({ id: t.id, label: t.title })),
    ];
    filters.innerHTML = chips
      .map(
        (c) =>
          `<button type="button" class="nb-chip" data-filter="${esc(c.id)}" ` +
          `aria-pressed="${c.id === filter}">${esc(c.label)}</button>`,
      )
      .join('');
  }

  function renderVars(entry: NotebookEntry): string {
    const rows = Object.entries(entry.vars)
      .map(
        ([name, meaning]) =>
          `<dt class="m-math">${renderIdentifier(name)}</dt><dd>${esc(meaning)}</dd>`,
      )
      .join('');
    return `<details class="nb-vars"><summary>Symbols</summary><dl>${rows}</dl></details>`;
  }

  function renderEntry(entry: NotebookEntry): string {
    const math = opts.typeset(entry.src);
    const current = opts.isCurrent(entry.src) ? ' current' : '';
    const note = entry.exampleNote
      ? `<span class="nb-example">Example: ${esc(entry.exampleNote)}</span>`
      : '';
    return (
      `<li class="nb-item${current}">` +
      `<button type="button" class="nb-pick" data-id="${esc(entry.id)}">` +
      `<span class="nb-name">${esc(entry.title)}</span>` +
      (math ? `<span class="nb-math">${math}</span>` : '') +
      `<span class="nb-about">${esc(entry.about)}</span>${note}</button>` +
      renderVars(entry) +
      '</li>'
    );
  }

  function renderSavedEntry(entry: SavedEntry): string {
    const math = opts.typeset(entry.src);
    const current = opts.isCurrent(entry.src) ? ' current' : '';
    return (
      `<li class="nb-item nb-mine${current}">` +
      `<button type="button" class="nb-pick" data-saved="${esc(entry.id)}" title="${esc(entry.src)}">` +
      `<span class="nb-name">${esc(entry.title)}</span>` +
      (math ? `<span class="nb-math">${math}</span>` : '') +
      `<span class="nb-raw">${esc(entry.src)}</span></button>` +
      `<button type="button" class="nb-del" data-del="${esc(entry.id)}" ` +
      `aria-label="Remove ${esc(entry.title)} from your notebook">×</button>` +
      '</li>'
    );
  }

  const group = (title: string, items: string[]) =>
    `<section class="nb-group"><h3 class="nb-group-title">${esc(title)}</h3>` +
    `<ul class="nb-grid">${items.join('')}</ul></section>`;

  function renderList() {
    const groups: string[] = [];
    const showSaved = filter === ALL || filter === SAVED;
    if (showSaved) {
      const mine = saved.filter((e) => matches(`${e.title} ${e.src}`.toLowerCase(), query));
      if (mine.length) groups.push(group('My equations', mine.map(renderSavedEntry)));
      else if (filter === SAVED && !query) {
        groups.push(
          '<p class="nb-empty">Nothing saved yet. Type an equation, then choose ' +
            '<b>Save current equation</b>.</p>',
        );
      }
    }
    for (const topic of NOTEBOOK) {
      if (filter !== ALL && filter !== topic.id) continue;
      const hits = topic.entries.filter((e) => matches(SEARCH_INDEX.get(e)!, query));
      if (hits.length) groups.push(group(topic.title, hits.map(renderEntry)));
    }
    list.innerHTML = groups.length
      ? groups.join('')
      : `<p class="nb-empty">No equations match “${esc(query)}”.</p>`;
  }

  function syncSaveButton() {
    saveOpen.disabled = !opts.current();
  }

  function render() {
    renderFilters();
    renderList();
    syncSaveButton();
  }

  function closeForm() {
    form.hidden = true;
    saveOpen.hidden = false;
  }

  filters.addEventListener('click', (e) => {
    const chip = (e.target as Element).closest<HTMLElement>('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter!;
    renderFilters();
    renderList();
  });

  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });

  list.addEventListener('click', (e) => {
    const target = e.target as Element;
    const del = target.closest<HTMLElement>('[data-del]');
    if (del) {
      saved = saved.filter((s) => s.id !== del.dataset.del);
      persist();
      render();
      return;
    }
    const pick = target.closest<HTMLElement>('.nb-pick');
    if (!pick) return;
    if (pick.dataset.id) {
      const entry = BY_ID.get(pick.dataset.id);
      if (entry) {
        const values = Object.fromEntries(
          Object.entries(entry.example).map(([k, v]) => [k, formatInput(v)]),
        );
        opts.onPick(entry.src, values);
      }
    } else if (pick.dataset.saved) {
      const entry = saved.find((s) => s.id === pick.dataset.saved);
      if (entry) opts.onPick(entry.src, entry.values);
    }
  });

  saveOpen.addEventListener('click', () => {
    const cur = opts.current();
    if (!cur) return;
    nameInput.value = cur.name;
    form.hidden = false;
    saveOpen.hidden = true;
    nameInput.focus();
    nameInput.select();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cur = opts.current();
    if (cur) {
      saved = addSaved(saved, nameInput.value, cur.src, newId(), cur.values);
      persist();
      filter = filter === ALL ? ALL : SAVED;
    }
    closeForm();
    render();
    saveOpen.focus();
  });

  q('.nb-save-cancel').addEventListener('click', () => {
    closeForm();
    saveOpen.focus();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeForm();
      saveOpen.focus();
    }
  });

  render();

  return {
    refresh() {
      for (const item of list.querySelectorAll<HTMLElement>('.nb-item')) {
        const pick = item.querySelector<HTMLElement>('.nb-pick')!;
        const src = pick.dataset.id
          ? BY_ID.get(pick.dataset.id)?.src
          : saved.find((s) => s.id === pick.dataset.saved)?.src;
        item.classList.toggle('current', !!src && opts.isCurrent(src));
      }
      syncSaveButton();
    },
  };
}
