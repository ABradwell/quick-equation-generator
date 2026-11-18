/**
 * DOM-free model of the visual math editor: tree, cursor, selection and every editing command.
 * The output is LaTeX for parseEquation(): see latex.js. Design notes live in docs/EDITOR.md.
 *
 * ## Data model (plain objects; every one has a stable string `id`)
 *
 *   Block = { kind: 'block', id, items: Item[], parent: Node | null }       // root.parent === null
 *   Atom  = { kind: 'atom',  id, text, latex, cls, parent: Block }
 *           cls: 'var' | 'num' | 'op' | 'fn' | 'greek' | 'const' | 'punct'
 *           `text` is what to display ("−", "·", "θ", "sin"), `latex` what is serialised.
 *   Node  = { kind, id, parent: Block, blocks: Block[], ...extra }
 *           kind 'frac'   blocks [num, den]
 *                'sup'    blocks [exp]        attaches to the item before it
 *                'sub'    blocks [sub]        attaches to the item before it
 *                'sqrt'   blocks [arg], optional `index: Block` (nth root; drawn left of arg)
 *                'paren'  blocks [inner], open '(' '[' '{' '|', close ')' ']' '}' '|'
 *                'bigop'  blocks [lower, upper], op 'sum' | 'prod'; the body follows inline
 *   Use blocksOf(node) for the blocks in visual/navigation order (index first for a radical).
 *   Ids are unique across the whole page and survive undo/redo (restored items keep their id),
 *   so the view can key DOM elements on them. `model.find(id)` maps an id back to a block/item.
 *   The root Block object is permanent; undo/redo/setLatex replace its `items` (and everything
 *   below), so never keep object references to anything but the root across a change: re-read.
 *
 * ## State (read-only properties)
 *
 *   model.root        Block
 *   model.cursor      { block, index }    insertion point; the caret is drawn here (the moving
 *                                          end of the selection when there is one)
 *   model.selection   null | { block, start, end }   items [start, end) of one block; never empty
 *   model.version     integer, bumped whenever the tree changes (cheap "did it change" check)
 *   The cursor and selection objects are replaced (never mutated) when they change.
 *
 * ## Methods
 *
 *   Input (all return true if they did something, false if they were a no-op)
 *     typeChar(ch)        one typed character: digits, letters (auto-words), operators, brackets,
 *                         '/' (fraction), '^' '_' (scripts), unicode π θ ≤ ≥ · √ ... Space only
 *                         commits a pending word. Replaces / wraps a selection.
 *     typeText(str)       typeChar for each character (paste fallback, IME text)
 *     paste(text)         import LaTeX/ASCII via fromLatex and splice it in; if it does not
 *                         parse, falls back to typeText
 *     backspace() del()   delete backward / forward; enter, unwrap or delete nodes (see spec)
 *     moveLeft/moveRight/moveUp/moveDown({ shift })   arrow keys; shift extends the selection
 *     home/end({ shift })  start/end of the current block (again: of the whole expression)
 *     selectAll()         select the whole expression
 *     setCursor(block, index, { extend })   click/drag: `block` is a Block or a block id; with
 *                         extend:true the selection is extended from the previous caret (drag)
 *     commitWord()        convert a pending auto-word (e.g. the "sin" waiting for a possible "h");
 *                         call on blur / Enter
 *     insert(kind, options)   palette: 'frac' | 'sqrt' | 'nthroot' | 'sup' | 'sub' |
 *                         'paren' {type:'('|'['|'{'|'|'} | 'bigop' {op:'sum'|'prod'} |
 *                         'atom' {text, latex, cls} | 'word' {name:'sin'|'theta'|'pi'|...} |
 *                         'piecewise' | 'latex' {latex}.  Wraps the selection where sensible.
 *     undo() redo()       canUndo() canRedo()
 *   Document
 *     getLatex()  setLatex(src, { resetHistory })  -> {ok} | {ok:false,error}   clear()  isEmpty()
 *     getSelectionLatex() LaTeX of the selection ('' if none)
 *   Lookup
 *     find(id)            Block | Atom | Node | null
 *   Events
 *     onChange(fn)        fn(model, { content, selection }) after every command that changed the
 *                         tree (content) or just the cursor/selection. Returns an unsubscribe fn.
 *
 * Also exported: blocksOf, isAtom, isNode, isBlock, indexOfItem, toLatex, fromLatex, makeBlock.
 *
 * ## Auto-words
 * Typed letters stay single `var` atoms until they spell a known word. A word that could still
 * grow into a longer one (sin -> sinh, atan -> atan2, epsi -> epsilon) is "pending": it converts
 * when the next input does not extend it (any non-letter, a different letter, any navigation or
 * commitWord()). While pending, Backspace edits the letters normally.
 */
import { fromLatex, toLatex } from './latex.js';
import {
  AUTO_PREFIXES,
  AUTO_WORDS,
  CLOSE_OF,
  MAX_WORD,
  OPEN_OF,
  atomForChar,
  blocksOf,
  indexOfItem,
  isAtom,
  isBlock,
  isNode,
  makeAtom,
  makeBigop,
  makeBlock,
  makeFrac,
  makeParen,
  makeScript,
  makeSqrt,
  makeWord,
} from './tree.js';

export { blocksOf, fromLatex, indexOfItem, isAtom, isBlock, isNode, makeBlock, toLatex };

const MAX_HISTORY = 500;
const OPERAND_CLS = new Set(['var', 'num', 'const', 'greek']);
const OPERAND_NODES = new Set(['paren', 'sqrt', 'frac']);
const isScript = (item) => item?.kind === 'sup' || item?.kind === 'sub';
const isOperandItem = (item) =>
  item.kind === 'atom' ? OPERAND_CLS.has(item.cls) : OPERAND_NODES.has(item.kind);

// -------------------------------------------------------------- snapshots

function serializeItem(item) {
  if (item.kind === 'atom') {
    return { k: 'atom', id: item.id, text: item.text, latex: item.latex, cls: item.cls };
  }
  const out = {
    k: item.kind,
    id: item.id,
    blocks: item.blocks.map((b) => ({ id: b.id, items: b.items.map(serializeItem) })),
  };
  if (item.index) out.index = { id: item.index.id, items: item.index.items.map(serializeItem) };
  if (item.open) out.open = item.open;
  if (item.close) out.close = item.close;
  if (item.op) out.op = item.op;
  return out;
}

function deserializeBlock(data, parent) {
  const block = { kind: 'block', id: data.id, items: [], parent };
  block.items = data.items.map((d) => {
    const item = deserializeItem(d);
    item.parent = block;
    return item;
  });
  return block;
}

function deserializeItem(d) {
  if (d.k === 'atom') {
    return { kind: 'atom', id: d.id, text: d.text, latex: d.latex, cls: d.cls, parent: null };
  }
  const node = { kind: d.k, id: d.id, parent: null, blocks: [] };
  if (d.open) node.open = d.open;
  if (d.close) node.close = d.close;
  if (d.op) node.op = d.op;
  node.blocks = d.blocks.map((b) => deserializeBlock(b, node));
  if (d.index) node.index = deserializeBlock(d.index, node);
  return node;
}

function pathOf(block) {
  const steps = [];
  let b = block;
  while (b.parent) {
    const node = b.parent;
    steps.push([indexOfItem(node), blocksOf(node).indexOf(b)]);
    b = node.parent;
  }
  return steps.reverse();
}

function resolvePath(root, path) {
  let block = root;
  for (const [itemIndex, blockIndex] of path) {
    const node = block.items[itemIndex];
    if (!node || !isNode(node)) return root;
    block = blocksOf(node)[blockIndex] ?? root;
  }
  return block;
}

const lastIndex = (block) => block.items.length;

// ------------------------------------------------------------------ model

export class MathModel {
  constructor() {
    this.root = makeBlock();
    this.cursor = { block: this.root, index: 0 };
    this.selection = null;
    this.version = 0;
    this._anchor = null;
    this._listeners = new Set();
    this._undo = [];
    this._redo = [];
    this._lastKey = null;
    this._depth = 0;
    this._resetCommand();
  }

  // ---------------------------------------------------------- command plumbing

  _resetCommand() {
    this._pending = null;
    this._changed = false;
    this._skipHistory = false;
    this._key = null;
    this._startCursor = this.cursor;
  }

  _run(fn) {
    if (this._depth > 0) return fn();
    this._depth++;
    this._resetCommand();
    const beforeCursor = this.cursor;
    const beforeSel = this.selection;
    let result;
    try {
      result = fn();
    } finally {
      this._depth--;
    }
    if (this._changed) {
      if (!this._skipHistory) {
        if (!(this._key && this._key === this._lastKey)) {
          this._undo.push(this._pending);
          if (this._undo.length > MAX_HISTORY) this._undo.shift();
        }
        this._redo.length = 0;
        this._lastKey = this._key;
      } else {
        this._lastKey = null;
      }
      this.version++;
    } else {
      this._lastKey = null;
    }
    const selectionChanged = !sameSelection(beforeSel, this.selection);
    if (this._changed || selectionChanged || !sameCursor(beforeCursor, this.cursor)) {
      const info = { content: this._changed, selection: selectionChanged };
      for (const fn2 of [...this._listeners]) fn2(this, info);
    }
    return result;
  }

  _snapshot(cursor) {
    return {
      items: this.root.items.map(serializeItem),
      path: pathOf(cursor.block),
      index: cursor.index,
    };
  }

  _restore(snap) {
    const rebuilt = deserializeBlock({ id: this.root.id, items: snap.items }, null);
    this.root.items = rebuilt.items;
    for (const item of this.root.items) item.parent = this.root;
    const block = resolvePath(this.root, snap.path);
    this.cursor = { block, index: Math.min(snap.index, block.items.length) };
    this._clearSelection();
    this._changed = true;
    this._skipHistory = true;
  }

  // Call before every tree mutation: records the pre-command state once per command.
  _touch() {
    this._changed = true;
    if (this._pending === null) this._pending = this._snapshot(this._startCursor);
  }

  _splice(block, start, count, ...items) {
    this._touch();
    for (const item of items) item.parent = block;
    return block.items.splice(start, count, ...items);
  }

  _setCursor(block, index) {
    this.cursor = { block, index };
  }

  _clearSelection() {
    this.selection = null;
    this._anchor = null;
  }

  // ------------------------------------------------------------ public reads

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getLatex() {
    return toLatex(this.root);
  }

  isEmpty() {
    return this.root.items.length === 0;
  }

  getSelectionLatex() {
    const sel = this.selection;
    return sel ? toLatex(sel.block.items.slice(sel.start, sel.end)) : '';
  }

  canUndo() {
    return this._undo.length > 0;
  }

  canRedo() {
    return this._redo.length > 0;
  }

  find(id) {
    const visit = (block) => {
      if (block.id === id) return block;
      for (const item of block.items) {
        if (item.id === id) return item;
        if (isNode(item)) {
          for (const b of blocksOf(item)) {
            const hit = visit(b);
            if (hit) return hit;
          }
        }
      }
      return null;
    };
    return visit(this.root);
  }

  // Is `block` still part of the tree (blocks of deleted nodes keep their parent pointers)?
  _attached(block) {
    let b = block;
    while (b !== this.root) {
      const node = b.parent;
      const holder = node?.parent;
      if (!holder || !holder.items.includes(node)) return false;
      b = holder;
    }
    return true;
  }

  // ------------------------------------------------------- document commands

  setLatex(src, { resetHistory = false } = {}) {
    const result = fromLatex(src);
    if (!result.ok) return result;
    this._run(() => {
      if (toLatex(result.root) !== this.getLatex()) {
        this._touch();
        this.root.items = result.root.items;
        for (const item of this.root.items) item.parent = this.root;
      }
      this._clearSelection();
      this._setCursor(this.root, this.root.items.length);
    });
    if (resetHistory) {
      this._undo.length = 0;
      this._redo.length = 0;
      this._lastKey = null;
    }
    return { ok: true };
  }

  clear() {
    return this._run(() => {
      this._clearSelection();
      if (this.root.items.length) this._splice(this.root, 0, this.root.items.length);
      this._setCursor(this.root, 0);
      return true;
    });
  }

  undo() {
    return this._run(() => {
      if (!this._undo.length) return false;
      this._redo.push(this._snapshot(this.cursor));
      this._restore(this._undo.pop());
      return true;
    });
  }

  redo() {
    return this._run(() => {
      if (!this._redo.length) return false;
      this._undo.push(this._snapshot(this.cursor));
      this._restore(this._redo.pop());
      return true;
    });
  }

  // ----------------------------------------------------------- auto-words

  // Trailing run of single-letter variables before the cursor.
  _letterRun() {
    const { block, index } = this.cursor;
    let start = index;
    while (start > 0) {
      const item = block.items[start - 1];
      if (item.kind === 'atom' && item.cls === 'var' && /^[A-Za-z]$/.test(item.text)) start--;
      else break;
    }
    let text = '';
    for (let i = start; i < index; i++) text += block.items[i].text;
    return text;
  }

  _longestWordSuffix(run) {
    for (let len = Math.min(run.length, MAX_WORD); len >= 2; len--) {
      if (AUTO_WORDS.has(run.slice(-len))) return run.slice(-len);
    }
    return null;
  }

  // Replace the last word.length letters before the cursor with the word's atom/node.
  _convertWord(word, length = word.length) {
    const { block, index } = this.cursor;
    const item = makeWord(word);
    this._splice(block, index - length, length, item);
    if (isAtom(item)) this._setCursor(block, index - length + 1);
    else this._setCursor(blocksOf(item)[0], 0);
  }

  commitWord() {
    return this._run(() => this._commitWord());
  }

  _commitWord() {
    if (this.selection) return false;
    const word = this._longestWordSuffix(this._letterRun());
    if (!word) return false;
    this._convertWord(word);
    return true;
  }

  // Would typing `letter` extend the pending word (so it must not be converted yet)?
  _extendsPending(run, letter) {
    const pending = this._longestWordSuffix(run);
    if (!pending) return true;
    for (let len = run.length; len >= pending.length; len--) {
      const s = run.slice(-len) + letter;
      if (AUTO_WORDS.has(s) || AUTO_PREFIXES.has(s)) return true;
    }
    return false;
  }

  _typeLetter(ch) {
    if (this.selection) this._deleteSelection();
    else if (!this._extendsPending(this._letterRun(), ch)) this._commitWord();
    const { block, index } = this.cursor;
    this._splice(block, index, 0, atomForChar(ch));
    this._setCursor(block, index + 1);
    this._key = 'type';
    const run = this._letterRun();
    const word = this._longestWordSuffix(run);
    if (!word) return;
    // Hold back while the letters (from the word's start or earlier) could grow into a longer word.
    for (let len = run.length; len >= word.length; len--) {
      if (AUTO_PREFIXES.has(run.slice(-len))) return;
    }
    this._convertWord(word);
  }

  // ---------------------------------------------------------------- typing

  typeChar(ch) {
    return this._run(() => this._typeChar(ch));
  }

  typeText(text) {
    return this._run(() => {
      let all = true;
      for (const ch of text) all = this._typeChar(ch) && all;
      return all;
    });
  }

  paste(text) {
    return this._run(() => (this._insertLatex(text) ? true : this.typeText(text)));
  }

  _typeChar(ch) {
    if (ch === ' ') {
      const converted = this._commitWord();
      if (converted) this._key = 'type';
      return converted;
    }
    if (/^[A-Za-z]$/.test(ch)) {
      this._typeLetter(ch);
      return true;
    }
    if (ch === '2' && !this.selection && this._longestWordSuffix(this._letterRun()) === 'atan') {
      this._convertWord('atan2', 4);
      return true;
    }
    this._commitWord();
    switch (ch) {
      case '/':
      case '÷':
        return this._doFrac();
      case '^':
        return this._doScript('sup');
      case '_':
        return this._doScript('sub');
      case '(':
      case '[':
      case '{':
        return this._doParen(ch);
      case ')':
      case ']':
      case '}':
        return this._doClose(ch);
      case '|':
        return this._doBar();
      case '√':
        return this._doSqrt(false);
      default:
        break;
    }
    const atom = atomForChar(ch);
    if (!atom) return false;
    if (this.selection) this._deleteSelection();
    const { block, index } = this.cursor;
    const prev = block.items[index - 1];
    if (ch === '=' && isAtom(prev) && (prev.latex === '<' || prev.latex === '>')) {
      const merged = prev.latex === '<' ? atomForChar('≤') : atomForChar('≥');
      this._splice(block, index - 1, 1, merged);
      this._key = 'type';
      return true;
    }
    this._splice(block, index, 0, atom);
    this._setCursor(block, index + 1);
    this._key = 'type';
    return true;
  }

  // ------------------------------------------------------ structure helpers

  _takeSelection() {
    const { block, start, end } = this.selection;
    const items = this._splice(block, start, end - start);
    this._clearSelection();
    this._setCursor(block, start);
    return items;
  }

  _deleteSelection() {
    this._takeSelection();
  }

  // Start index of the fraction operand to the left of `index` in `block`.
  _operandStart(block, index) {
    const items = block.items;
    let start = index;
    let i = index - 1;
    while (i >= 0) {
      const item = items[i];
      if (isScript(item)) {
        let j = i;
        while (j >= 0 && isScript(items[j])) j--;
        if (j >= 0 && isOperandItem(items[j])) {
          start = j;
          i = j - 1;
          continue;
        }
        break;
      }
      if (!isOperandItem(item)) break;
      start = i;
      i--;
    }
    // sin(x)/2 : a function applied to a bracket belongs to the operand.
    if (start < index && items[start].kind === 'paren' && items[start].open === '(') {
      let k = start - 1;
      while (k >= 0 && isScript(items[k])) k--;
      if (k >= 0 && isAtom(items[k]) && items[k].cls === 'fn') start = k;
    }
    return start;
  }

  _doFrac() {
    let numItems;
    if (this.selection) numItems = this._takeSelection();
    else {
      const { block, index } = this.cursor;
      const start = this._operandStart(block, index);
      numItems = this._splice(block, start, index - start);
      this._setCursor(block, start);
      // (a+b)/2 : like Desmos, the bracket only grouped the numerator, so drop it.
      const only = numItems.length === 1 ? numItems[0] : null;
      if (only && only.kind === 'paren' && only.open === '(') numItems = only.blocks[0].items;
    }
    const node = makeFrac(numItems, []);
    const { block, index } = this.cursor;
    this._splice(block, index, 0, node);
    this._setCursor(node.blocks[numItems.length ? 1 : 0], 0);
    return true;
  }

  _doScript(kind) {
    if (this.selection) {
      const items = this._takeSelection();
      const node = makeScript(kind, items);
      const { block, index } = this.cursor;
      this._splice(block, index, 0, node);
      this._setCursor(node.blocks[0], items.length);
      return true;
    }
    const { block, index } = this.cursor;
    const left = block.items[index - 1];
    const right = block.items[index];
    if (left?.kind === kind) {
      this._setCursor(left.blocks[0], left.blocks[0].items.length);
      return true;
    }
    if (right?.kind === kind) {
      this._setCursor(right.blocks[0], 0);
      return true;
    }
    const node = makeScript(kind);
    this._splice(block, index, 0, node);
    this._setCursor(node.blocks[0], 0);
    return true;
  }

  _wrap(node, inner) {
    // Insert `node` at the cursor; `inner` is the block that receives a selection (if any).
    let items = [];
    if (this.selection) items = this._takeSelection();
    const { block, index } = this.cursor;
    for (const item of items) item.parent = inner;
    inner.items.push(...items);
    this._splice(block, index, 0, node);
    this._setCursor(inner, inner.items.length);
  }

  _doParen(open) {
    const node = makeParen(open);
    this._wrap(node, node.blocks[0]);
    return true;
  }

  _doSqrt(withIndex) {
    const node = withIndex ? makeSqrt([], []) : makeSqrt();
    this._wrap(node, node.blocks[0]);
    if (withIndex) this._setCursor(node.index, 0);
    return true;
  }

  _doBigop(op) {
    const node = makeBigop(op);
    let items = [];
    if (this.selection) items = this._takeSelection();
    const { block, index } = this.cursor;
    this._splice(block, index, 0, node, ...items);
    this._setCursor(node.blocks[0], 0);
    return true;
  }

  _prevIsOperand(block, index) {
    const prev = block.items[index - 1];
    if (!prev) return false;
    if (isAtom(prev)) return OPERAND_CLS.has(prev.cls);
    return prev.kind !== 'bigop';
  }

  _doBar() {
    const { block, index } = this.cursor;
    const parent = block.parent;
    if (
      !this.selection &&
      parent?.kind === 'paren' &&
      parent.open === '|' &&
      index === block.items.length &&
      this._prevIsOperand(block, index)
    ) {
      this._exitNode(parent);
      return true;
    }
    return this._doParen('|');
  }

  _exitNode(node) {
    const holder = node.parent;
    this._setCursor(holder, indexOfItem(node) + 1);
  }

  _doClose(ch) {
    if (this.selection) this._clearSelection();
    let cur = this.cursor.block;
    let atEnd = this.cursor.index === cur.items.length;
    while (atEnd && cur.parent) {
      const node = cur.parent;
      if (node.kind === 'paren' && node.close === ch) {
        this._exitNode(node);
        return true;
      }
      const blocks = blocksOf(node);
      if (blocks[blocks.length - 1] !== cur) break;
      cur = node.parent;
      atEnd = indexOfItem(node) === cur.items.length - 1;
    }
    // No open bracket to close: wrap everything to the left in this block.
    const { block, index } = this.cursor;
    const items = this._splice(block, 0, index);
    const node = makeParen(OPEN_OF[ch], items);
    this._splice(block, 0, 0, node);
    this._setCursor(block, 1);
    return true;
  }

  // ---------------------------------------------------------------- deleting

  backspace() {
    return this._run(() => this._backspace());
  }

  del() {
    return this._run(() => this._delete());
  }

  _removeNodeIfEmpty(node) {
    if (!blocksOf(node).every((b) => b.items.length === 0)) return false;
    const holder = node.parent;
    const at = indexOfItem(node);
    this._splice(holder, at, 1);
    this._setCursor(holder, at);
    return true;
  }

  // Replace `node` by the contents of its blocks. `where` places the cursor.
  _unwrap(node, block, where) {
    const holder = node.parent;
    const at = indexOfItem(node);
    const all = [];
    let offset = 0;
    for (const b of blocksOf(node)) {
      if (b === block && where === 'start') offset = all.length;
      all.push(...b.items);
    }
    if (where === 'end') offset = all.length;
    this._splice(holder, at, 1, ...all);
    this._setCursor(holder, at + offset);
  }

  _backspace() {
    if (this.selection) {
      this._deleteSelection();
      return true;
    }
    const { block, index } = this.cursor;
    if (index > 0) {
      const item = block.items[index - 1];
      if (isAtom(item)) {
        this._splice(block, index - 1, 1);
        this._setCursor(block, index - 1);
        this._key = 'backspace';
      } else {
        const blocks = blocksOf(item);
        const last = blocks[blocks.length - 1];
        this._setCursor(last, last.items.length);
      }
      return true;
    }
    const node = block.parent;
    if (!node) return false;
    if (this._removeNodeIfEmpty(node)) return true;
    const blocks = blocksOf(node);
    const pos = blocks.indexOf(block);
    if (pos > 0) {
      this._setCursor(blocks[pos - 1], blocks[pos - 1].items.length);
      return true;
    }
    this._unwrap(node, block, 'start');
    return true;
  }

  _delete() {
    if (this.selection) {
      this._deleteSelection();
      return true;
    }
    const { block, index } = this.cursor;
    if (index < block.items.length) {
      const item = block.items[index];
      if (isAtom(item)) {
        this._splice(block, index, 1);
        this._key = 'delete';
      } else {
        this._setCursor(blocksOf(item)[0], 0);
      }
      return true;
    }
    const node = block.parent;
    if (!node) return false;
    if (this._removeNodeIfEmpty(node)) return true;
    const blocks = blocksOf(node);
    const pos = blocks.indexOf(block);
    if (pos < blocks.length - 1) {
      this._setCursor(blocks[pos + 1], 0);
      return true;
    }
    this._unwrap(node, block, 'end');
    return true;
  }

  // -------------------------------------------------------------- navigation

  _leftOf({ block, index }) {
    if (index > 0) {
      const item = block.items[index - 1];
      if (isAtom(item)) return { block, index: index - 1 };
      const blocks = blocksOf(item);
      const last = blocks[blocks.length - 1];
      return { block: last, index: last.items.length };
    }
    const node = block.parent;
    if (!node) return null;
    const blocks = blocksOf(node);
    const pos = blocks.indexOf(block);
    if (pos > 0) return { block: blocks[pos - 1], index: blocks[pos - 1].items.length };
    return { block: node.parent, index: indexOfItem(node) };
  }

  _rightOf({ block, index }) {
    if (index < block.items.length) {
      const item = block.items[index];
      if (isAtom(item)) return { block, index: index + 1 };
      return { block: blocksOf(item)[0], index: 0 };
    }
    const node = block.parent;
    if (!node) return null;
    const blocks = blocksOf(node);
    const pos = blocks.indexOf(block);
    if (pos < blocks.length - 1) return { block: blocks[pos + 1], index: 0 };
    return { block: node.parent, index: indexOfItem(node) + 1 };
  }

  // Shift+arrow moves over whole items and leaves nodes instead of stepping between blocks.
  _stepOver(dir, { block, index }) {
    if (dir === 'left') {
      if (index > 0) return { block, index: index - 1 };
      return block.parent ? { block: block.parent.parent, index: indexOfItem(block.parent) } : null;
    }
    if (index < block.items.length) return { block, index: index + 1 };
    return block.parent
      ? { block: block.parent.parent, index: indexOfItem(block.parent) + 1 }
      : null;
  }

  _vertical(dir) {
    const { block, index } = this.cursor;
    const want = dir === 'up' ? 'sup' : 'sub';
    const other = dir === 'up' ? 'sub' : 'sup';
    const items = block.items;
    const left = items[index - 1];
    const right = items[index];
    if (left?.kind === want) {
      return { block: left.blocks[0], index: left.blocks[0].items.length };
    }
    if (left?.kind === other && items[index - 2]?.kind === want) {
      const n = items[index - 2];
      return { block: n.blocks[0], index: n.blocks[0].items.length };
    }
    if (right?.kind === want) return { block: right.blocks[0], index: 0 };
    let cur = block;
    let pos = index;
    while (cur.parent) {
      const node = cur.parent;
      const blocks = blocksOf(node);
      let target = null;
      if (node.kind === 'frac') {
        if (dir === 'up' && cur === blocks[1]) target = blocks[0];
        if (dir === 'down' && cur === blocks[0]) target = blocks[1];
      } else if (node.kind === 'bigop') {
        if (dir === 'up' && cur === blocks[0]) target = blocks[1];
        if (dir === 'down' && cur === blocks[1]) target = blocks[0];
      } else if ((node.kind === 'sup' && dir === 'down') || (node.kind === 'sub' && dir === 'up')) {
        return { block: node.parent, index: indexOfItem(node) + 1 };
      }
      if (target) {
        const ratio = cur.items.length ? pos / cur.items.length : 0;
        return { block: target, index: Math.round(ratio * target.items.length) };
      }
      pos = indexOfItem(node);
      cur = node.parent;
    }
    return null;
  }

  _goto(target, shift) {
    if (!target) return false;
    if (shift) this._extendTo(target);
    else {
      this._clearSelection();
      this.cursor = target;
    }
    return true;
  }

  _move(dir, { shift = false } = {}) {
    this._commitWord();
    if (shift) return this._goto(this._stepOver(dir, this.cursor), true);
    const sel = this.selection;
    if (sel) {
      this._clearSelection();
      this._setCursor(sel.block, dir === 'left' ? sel.start : sel.end);
      return true;
    }
    return this._goto(dir === 'left' ? this._leftOf(this.cursor) : this._rightOf(this.cursor));
  }

  moveLeft(opts) {
    return this._run(() => this._move('left', opts));
  }

  moveRight(opts) {
    return this._run(() => this._move('right', opts));
  }

  moveUp({ shift = false } = {}) {
    return this._run(() => {
      this._commitWord();
      return this._goto(this._vertical('up'), shift);
    });
  }

  moveDown({ shift = false } = {}) {
    return this._run(() => {
      this._commitWord();
      return this._goto(this._vertical('down'), shift);
    });
  }

  home({ shift = false } = {}) {
    return this._run(() => {
      this._commitWord();
      const { block, index } = this.cursor;
      return this._goto({ block: index > 0 ? block : this.root, index: 0 }, shift);
    });
  }

  end({ shift = false } = {}) {
    return this._run(() => {
      this._commitWord();
      const { block, index } = this.cursor;
      const target = index < lastIndex(block) ? block : this.root;
      return this._goto({ block: target, index: lastIndex(target) }, shift);
    });
  }

  selectAll() {
    return this._run(() => {
      this._commitWord();
      const root = this.root;
      this._anchor = { block: root, index: 0 };
      this.cursor = { block: root, index: root.items.length };
      this._computeSelection();
      return this.selection !== null;
    });
  }

  setCursor(block, index, { extend = false } = {}) {
    return this._run(() => {
      const target = typeof block === 'string' ? this.find(block) : block;
      if (!isBlock(target) || !this._attached(target)) return false;
      const ref = target.items[index] ?? null;
      this._commitWord();
      let i = Math.max(0, Math.min(index, target.items.length));
      if (ref) {
        const found = target.items.indexOf(ref);
        i = found >= 0 ? found : Math.min(i, target.items.length);
      } else {
        i = target.items.length;
      }
      return this._goto({ block: target, index: i }, extend);
    });
  }

  // ---------------------------------------------------------------- selection

  _extendTo(target) {
    if (!this._anchor) this._anchor = this.cursor;
    this.cursor = target;
    this._computeSelection();
  }

  _computeSelection() {
    const a = this._anchor;
    const f = this.cursor;
    // Common ancestor block of anchor and focus.
    const chain = new Set();
    for (let b = a.block; b; b = b.parent?.parent) chain.add(b);
    let common = f.block;
    while (!chain.has(common)) common = common.parent.parent;
    const lift = (c) => {
      let b = c.block;
      if (b === common) return { idx: c.index, inside: false };
      let node;
      while (b !== common) {
        node = b.parent;
        b = node.parent;
      }
      return { idx: indexOfItem(node), inside: true };
    };
    const la = lift(a);
    const lf = lift(f);
    const pa = la.idx + (la.inside ? 0.5 : 0);
    const pf = lf.idx + (lf.inside ? 0.5 : 0);
    let start;
    let end;
    if (la.inside && lf.inside && la.idx === lf.idx) {
      start = la.idx;
      end = la.idx + 1;
    } else if (pf >= pa) {
      start = la.idx;
      end = lf.inside ? lf.idx + 1 : lf.idx;
    } else {
      start = lf.idx;
      end = la.inside ? la.idx + 1 : la.idx;
    }
    this.selection = start < end ? { block: common, start, end } : null;
  }

  // ---------------------------------------------------------------- insertion

  insert(kind, options = {}) {
    return this._run(() => this._insert(kind, options));
  }

  _insert(kind, o) {
    this._commitWord();
    switch (kind) {
      case 'frac':
        return this._doFrac();
      case 'sqrt':
        return this._doSqrt(false);
      case 'nthroot':
        return this._doSqrt(true);
      case 'sup':
        return this._doScript('sup');
      case 'sub':
        return this._doScript('sub');
      case 'paren': {
        const open = o.type ?? o.open ?? '(';
        return open in CLOSE_OF ? this._doParen(open) : false;
      }
      case 'bigop':
        return this._doBigop(o.op === 'prod' ? 'prod' : 'sum');
      case 'atom': {
        if (!o.text && !o.latex) return false;
        const atom = makeAtom(o.text ?? o.latex, o.latex ?? o.text, o.cls ?? 'var');
        if (this.selection) this._deleteSelection();
        const { block, index } = this.cursor;
        this._splice(block, index, 0, atom);
        this._setCursor(block, index + 1);
        return true;
      }
      case 'word': {
        const item = makeWord(o.name);
        if (!item) return false;
        if (this.selection) this._deleteSelection();
        const { block, index } = this.cursor;
        this._splice(block, index, 0, item);
        if (isAtom(item)) this._setCursor(block, index + 1);
        else this._setCursor(blocksOf(item)[0], 0);
        return true;
      }
      case 'piecewise': {
        const node = makeParen('{', [makeAtom(':', ':', 'punct'), makeAtom(',', ',', 'punct')]);
        this._wrapReplace(node);
        this._setCursor(node.blocks[0], 0);
        return true;
      }
      case 'latex':
        return this._insertLatex(typeof o === 'string' ? o : (o.latex ?? ''));
      default:
        return false;
    }
  }

  _wrapReplace(node) {
    if (this.selection) this._deleteSelection();
    const { block, index } = this.cursor;
    this._splice(block, index, 0, node);
    this._setCursor(block, index + 1);
  }

  _insertLatex(src) {
    const result = fromLatex(src);
    if (!result.ok) return false;
    const items = [...result.root.items];
    if (!items.length) return true;
    this._commitWord();
    if (this.selection) this._deleteSelection();
    const { block, index } = this.cursor;
    this._splice(block, index, 0, ...items);
    const empty = findEmptyBlock(items);
    if (empty) this._setCursor(empty, 0);
    else this._setCursor(block, index + items.length);
    return true;
  }
}

function findEmptyBlock(items) {
  for (const item of items) {
    if (!isNode(item)) continue;
    for (const b of blocksOf(item)) {
      if (b.items.length === 0) return b;
      const hit = findEmptyBlock(b.items);
      if (hit) return hit;
    }
  }
  return null;
}

function sameCursor(a, b) {
  return a.block === b.block && a.index === b.index;
}

function sameSelection(a, b) {
  if (!a || !b) return a === b;
  return a.block === b.block && a.start === b.start && a.end === b.end;
}
