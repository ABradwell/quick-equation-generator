# Visual math editor — design

A Desmos/MathQuill-style editor written from scratch. Typing `/` makes a stacked fraction,
`^` opens a superscript, `sqrt` becomes a radical, and so on. Its output is a LaTeX string
that `parseEquation()` accepts, so the rest of the app (preview, code generation, graph,
history) is unchanged: **the editor is just another way to produce the source string.**

## Files

| File                        | Role                                                                      | DOM? |
| --------------------------- | ------------------------------------------------------------------------- | ---- |
| `src/lib/editor/model.ts`   | Tree, cursor, selection and every editing command                         | no   |
| `src/lib/editor/latex.ts`   | `toLatex(block)` and `fromLatex(string)`                                  | no   |
| `src/lib/editor/view.ts`    | Renders the tree, cursor, selection; keyboard, mouse, paste, mobile input | yes  |
| `src/lib/editor/palette.ts` | Button palette definitions + rendering; drives the editor or the text box | yes  |
| `test/editor/*.test.ts`     | `node:test` suites for model.ts and latex.ts                              | —    |

model.ts and latex.ts must not touch `document` or `window`, so they can be tested in Node.

## Model

```
Block   = { kind: 'block', items: Item[], parent: Node | null }
Item    = Atom | Node
Atom    = { kind: 'atom', text: string, latex: string, cls: 'var'|'num'|'op'|'fn'|'greek'|'const'|'punct' }
          e.g. {text:'x', latex:'x'}, {text:'θ', latex:'\\theta'}, {text:'sin', latex:'\\sin'},
               {text:'π', latex:'\\pi'}, {text:'≤', latex:'\\le'}, {text:'·', latex:'\\cdot'}
Node    = { kind: 'frac',   blocks: [num, den] }
        | { kind: 'sup',    blocks: [exp] }                 // attaches to the item before it
        | { kind: 'sub',    blocks: [sub] }                 // attaches to the item before it
        | { kind: 'sqrt',   blocks: [arg], index?: Block }  // index present => nth root
        | { kind: 'paren',  open: '('|'['|'{'|'|', close: ')'|']'|'}'|'|', blocks: [inner] }
        | { kind: 'bigop',  op: 'sum'|'prod', blocks: [lower, upper] }   // body follows inline
Cursor  = { block: Block, index: number }   // index = insertion point in block.items
```

Every Node's blocks have `parent` pointing back at the Node, and every Item knows its
parent Block (store it, or compute it — implementer's choice, but navigation must be O(depth)).
`sqrt.index`, when present, is navigable (left of the radicand).

The root is a Block. The editor state is `{ root, cursor, selection }` where `selection` is
either null or `{ block, start, end }` — a contiguous range of items inside one block
(selections that cross structure boundaries are widened to the common block, like MathQuill).

## LaTeX contract (`latex.ts`)

`toLatex(root)` emits LaTeX the parser understands:

| Model     | LaTeX                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------- | --------- | --- |
| atom      | its `latex`; commands (`\pi`, `\sin`, `\theta`, `\le`, `\cdot`) get a trailing space when followed by a letter |
| frac      | `\frac{num}{den}`                                                                                              |
| sup / sub | `^{...}` / `_{...}` (single-character contents may drop braces: `x^2`)                                         |
| sqrt      | `\sqrt{...}` or `\sqrt[n]{...}`                                                                                |
| paren     | `\left(...\right)`, `\left[...\right]`, `\left\{...\right\}`, `\left                                           | ...\right | `   |
| bigop     | `\sum_{lower}^{upper}` / `\prod_{lower}^{upper}`                                                               |

Empty blocks serialize to an empty group, which the parser will reject with a normal
error — the UI then shows "incomplete" rather than crashing.

`fromLatex(src)` is a lenient importer used for history items, examples, paste and
switching from text mode. It must accept everything `toLatex` emits **and** the plain-ASCII
forms people type: `x^2`, `x^{10}`, `x_1`, `sqrt(x)` (→ sqrt node), `|x|`, `(…)`, `[…]`,
`{x<0: -x, x}`, `\frac{a}{b}`, `\sqrt[3]{x}`, `\sum_{n=1}^{10}`, `sum_(n=1)^{N}`, Greek
names (`theta`, `\theta`, `θ`), function words (`sin`, `\sin`, `\operatorname{sin}`), `pi`, `π`,
`<=`, `\le`, `≤`, `*`, `\cdot`, `·`. Plain `a/b` stays as atoms `a`, `/`, `b` (don't guess
fractions on import). Returns `{ root, ok: true }` or `{ ok: false, error }` if it can't build a
tree (e.g. unbalanced brackets) — the app then falls back to text mode.

**Round-trip requirement:** for every fixture in `test/helpers/fixtures.ts`,
`parseEquation(toLatex(fromLatex(src).root))` must evaluate to the same values as
`parseEquation(src)` (use `loadFixtures()` + `evaluate` + `close`).

## Editing commands (`model.ts`)

Expose a small class, e.g. `new MathModel()` / `model.load(root)`, with methods the view calls.
Behaviour (Desmos is the reference):

- **Typing characters** inserts atoms. Digits → `num`, letters → `var`, `+ - * = < > , : !` → `op`/`punct`
  (`*` shows as `·`, `<=`/`>=` typed as two keys collapse to `≤`/`≥`).
- **Auto-words**: after inserting a letter, if the letters immediately before the cursor end
  with a known word, replace them: function names (`sin cos tan sec csc cot asin acos atan
arcsin arccos arctan sinh cosh tanh exp ln log min max abs floor ceil round sign mod atan2`)
  → one `fn` atom; Greek names (`alpha … omega`, as in parser.ts) → `greek` atom; `pi`,
  `tau` → `const` atom; `sqrt` → a sqrt node with the cursor inside; `sum`/`prod` → a bigop with
  the cursor in `lower`; `nthroot` → sqrt with index. Use the longest match (`asinh` over `sinh`),
  and don't fire on `cos` while the user may still be typing `cosh` — i.e. only words that
  aren't a prefix of a longer word convert immediately; `cos`/`sin`/`tan`/`atan` convert when the
  next typed character isn't `h`/`2` (or on any non-letter / navigation).
- **`/`** creates a fraction. Numerator = the selection if any, otherwise the "operand"
  immediately before the cursor: walk left over atoms of class `var`/`num`/`const`/`greek` and
  over nodes (paren, sqrt, frac, sup/sub attached to them), stopping at an `op`/`punct`/`fn`
  atom or a bigop. Cursor goes to the denominator (or to the numerator if it is empty).
- **`^` / `_`** insert sup/sub with the cursor inside (wrap the selection if any).
  If a sup already follows the cursor's left item, `^` moves into it instead of adding another.
- **Brackets**: `(`, `[`, `{`, `|` insert a paren node with the cursor inside (wrapping the
  selection if any). Typing the matching closer while the cursor is at the end of that paren's
  inner block just moves the cursor out. A closer with no open paren to its left in the block
  wraps everything to its left in the block (MathQuill behaviour).
- **Backspace**: deletes the item to the left. If that item is a node, move into its last
  block's end instead of deleting (one more Backspace in an empty node deletes it). At the
  start of a block: if every block of the parent node is empty, delete the node; otherwise
  "unwrap" it — splice the contents of its blocks out into the parent block in order (for a
  frac at the start of the denominator, just move to the end of the numerator first). With a
  selection, delete the selection. **Delete** is the forward mirror.
- **Arrows**: Left/Right move one item, entering nodes into their first/last block and
  stepping block-to-block (num→den, index→radicand, lower→upper). Up/Down move between
  vertically arranged blocks (den↔num, into/out of sup/sub, upper↔lower) keeping roughly the
  same position. Home/End go to the ends of the current block (twice → root ends).
- **Selection**: Shift+arrows extend; `selectAll()`; typing or inserting a structure replaces /
  wraps the selection. `getSelectionLatex()` for copy.
- **Insert from palette**: `insert(kind, options)` — `frac`, `sqrt`, `nthroot`, `sup`, `sub`,
  `paren` (with type), `bigop`, `atom` (text/latex/cls), `latex` (a snippet run through
  `fromLatex` and spliced in, cursor placed in the first empty block if any, else after it).
- `isEmpty()`, `getLatex()`, `setLatex(src)` (via `fromLatex`), `clear()`.
- **Change notification**: `model.onChange(fn)` called after every mutation.
- **Undo/redo**: snapshot-based (`toLatex` + cursor path) history, coalescing consecutive typed
  characters; `undo()`, `redo()`.

## View (`view.ts`)

- `createEditor(container, { onChange, onEnter })` returns `{ model, focus(), getLatex(),
setLatex(src), insert(...), destroy() }`.
- Renders the tree as nested spans styled to match `render.ts` (same fonts, fraction bar,
  radical, big operators, stretchy brackets via CSS scale or SVG). Empty blocks show a faint
  placeholder box. A blinking caret element sits at the cursor; selection highlighted.
- Keyboard input goes through a visually hidden `<textarea>` that holds focus (so mobile
  keyboards and IME work); handle `keydown` for navigation/editing keys and `input` for
  characters, then clear the textarea. Ctrl/Cmd+A/C/X/V/Z/Y/Shift+Z work; paste imports via
  `fromLatex`, falling back to inserting the pasted text character by character.
- Click places the cursor at the nearest item boundary (use element rects); drag selects.
- Accessible: `role="textbox"`, `aria-label`, `aria-live` summary of the LaTeX for screen readers.

## Palette (`palette.ts`)

A compact, grouped toolbar above the editor: **Structure** (fraction, xⁿ, x², xₙ, √, ⁿ√, |x|,
( ), Σ, Π, piecewise `{ □ : □ , □ }`), **Functions** (sin cos tan ln log exp, plus a "more"
popover: inverse trig, hyperbolic, floor/ceil/round/abs/sign/min/max/mod), **Symbols** (π e θ
≤ ≥ < > and a Greek popover). Buttons show a small typeset glyph and a tooltip with the
keyboard shortcut ("Type / for a fraction"). In visual mode a button calls
`editor.insert(...)` (wrapping the selection where it makes sense) and keeps focus in the
editor. In text mode it inserts the LaTeX snippet at the textarea caret, placing the caret
in the first `{}`. Buttons must not steal focus (`mousedown` preventDefault).
