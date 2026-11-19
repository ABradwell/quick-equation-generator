// Pure helpers for the physics notebook: search, saved equations and number formatting.
// Nothing here touches the DOM, so it is covered by test/notebook.test.ts.

import type { NotebookEntry } from './data.ts';

/** An equation the user saved to their notebook. */
export interface SavedEntry {
  id: string;
  title: string;
  src: string;
  /** Evaluate panel inputs at the time of saving, by parameter name. */
  values?: Record<string, string>;
}

export const SAVED_MAX = 200;

/**
 * Format a number so the Evaluate panel parses it back exactly.
 * `5.972e24` would read as 5.972·e·24 (Euler's number), so large and small values use `*10^`.
 */
export function formatInput(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (value !== 0 && (abs >= 1e6 || abs < 1e-3)) {
    const [mantissa, exponent] = value.toExponential().split('e');
    const m = String(Number(Number(mantissa).toPrecision(12)));
    return `${m}*10^${Number(exponent)}`;
  }
  return String(Number(value.toPrecision(12)));
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Text an entry is found by: title, description, topic, symbol meanings and source. */
export function searchText(entry: NotebookEntry, topic: string): string {
  return fold(
    [
      entry.title,
      entry.about,
      topic,
      entry.exampleNote ?? '',
      ...Object.entries(entry.vars).flat(),
      entry.src,
    ].join(' '),
  );
}

/** True when every word of the query appears somewhere in `haystack` (already folded). */
export function matches(haystack: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}

/** Parse saved equations from storage, dropping anything malformed. */
export function parseSaved(raw: string | null): SavedEntry[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SavedEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { id, title, src, values } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof title !== 'string' || typeof src !== 'string') continue;
    if (!src.trim() || seen.has(id)) continue;
    seen.add(id);
    const entry: SavedEntry = { id, title: title.trim() || src.trim(), src: src.trim() };
    const clean = cleanValues(values);
    if (clean) entry.values = clean;
    out.push(entry);
    if (out.length >= SAVED_MAX) break;
  }
  return out;
}

function cleanValues(values: unknown): Record<string, string> | null {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (typeof v === 'string') out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** Add an equation to the front of the saved list, replacing an existing copy of the same source. */
export function addSaved(
  list: SavedEntry[],
  title: string,
  src: string,
  id: string,
  values?: Record<string, string>,
): SavedEntry[] {
  const text = src.trim();
  const entry: SavedEntry = { id, title: title.trim() || text, src: text };
  const clean = cleanValues(values);
  if (clean) entry.values = clean;
  return [entry, ...list.filter((e) => e.src !== text)].slice(0, SAVED_MAX);
}
