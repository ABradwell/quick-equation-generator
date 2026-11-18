// Pure helpers shared by the editor view, the palette and the app (no DOM, unit-tested).

/** Marks where the caret goes in a text-mode snippet. */
export const CARET = '‸';

/** True while any structure still has an empty slot (fraction without a denominator, bare radical, ...). */
export function isIncomplete(root) {
  const walk = (block, isRoot) => {
    if (!isRoot && block.items.length === 0) return true;
    return block.items.some(
      (item) =>
        item.kind !== 'atom' &&
        ((item.index && walk(item.index, false)) || item.blocks.some((b) => walk(b, false))),
    );
  };
  return walk(root, true);
}

/**
 * Insert a LaTeX snippet into a text box value.
 * The snippet marks the caret with CARET. A selection is moved to the caret position (so
 * selecting `x+1` and pressing the fraction button gives `\frac{x+1}{}`), and the caret ends
 * after it; with no selection the caret lands at the marker.
 * Returns { value, start, insert, from, to }: the new value, the new caret offset, and the text
 * that replaces the range [from, to) (so callers can use an undo-friendly insertText).
 */
export function applySnippet(value, selStart, selEnd, snippet) {
  const at = snippet.indexOf(CARET);
  const clean = at < 0 ? snippet : snippet.replace(CARET, '');
  const caret = at < 0 ? clean.length : at;
  const selected = value.slice(selStart, selEnd);
  const out = clean.slice(0, caret) + selected + clean.slice(caret);
  return {
    value: value.slice(0, selStart) + out + value.slice(selEnd),
    start: selStart + caret + selected.length,
    insert: out,
    from: selStart,
    to: selEnd,
  };
}

const FN_LABELS = {
  asin: 'arcsin',
  acos: 'arccos',
  atan: 'arctan',
  asinh: 'arsinh',
  acosh: 'arcosh',
  atanh: 'artanh',
  arcsinh: 'arsinh',
  arccosh: 'arcosh',
  arctanh: 'artanh',
};

/** How a function atom is spelled on screen (matches the typeset preview). */
export const fnDisplay = (text) => FN_LABELS[text] ?? text;
