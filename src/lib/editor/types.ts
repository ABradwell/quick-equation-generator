// Data shapes of the visual math editor model. See the doc block at the top of model.ts.

export type AtomClass = 'var' | 'num' | 'op' | 'fn' | 'greek' | 'const' | 'punct';
export type NodeKind = 'frac' | 'sup' | 'sub' | 'sqrt' | 'paren' | 'bigop';
export type OpenBracket = '(' | '[' | '{' | '|';
export type CloseBracket = ')' | ']' | '}' | '|';
export type BigOp = 'sum' | 'prod';

export interface Block {
  kind: 'block';
  id: string;
  items: Item[];
  /** The node that owns this block, or null for the root. */
  parent: MathNode | null;
}

export interface Atom {
  kind: 'atom';
  id: string;
  /** What is displayed ("−", "·", "θ", "sin"). */
  text: string;
  /** What is serialised. */
  latex: string;
  cls: AtomClass;
  parent: Block | null;
}

/**
 * A structure node. `blocks` holds [num, den] for 'frac', [exp] / [sub] for scripts,
 * [arg] for 'sqrt' (optional `index` for an nth root), [inner] for 'paren' and
 * [lower, upper] for 'bigop'.
 */
export interface MathNode {
  kind: NodeKind;
  id: string;
  parent: Block | null;
  blocks: Block[];
  /** 'sqrt' only: the root index of an nth root. */
  index?: Block;
  /** 'paren' only. */
  open?: OpenBracket;
  /** 'paren' only. */
  close?: CloseBracket;
  /** 'bigop' only. */
  op?: BigOp;
}

export type Item = Atom | MathNode;
export type TreeObject = Block | Item;

/** Insertion point: `index` is a position in `block.items`. */
export interface Cursor {
  block: Block;
  index: number;
}

/** Items [start, end) of one block; never empty. */
export interface Selection {
  block: Block;
  start: number;
  end: number;
}

/** Result of fromLatex(). The absent member is typed as undefined so both can be read. */
export type LatexResult =
  | { ok: true; root: Block; error?: undefined }
  | { ok: false; error: string; root?: undefined };

export interface ChangeInfo {
  content: boolean;
  selection: boolean;
}

export type ChangeListener<M> = (model: M, info: ChangeInfo) => void;

export interface MoveOptions {
  shift?: boolean;
}

export type InsertKind =
  | 'frac'
  | 'sqrt'
  | 'nthroot'
  | 'sup'
  | 'sub'
  | 'paren'
  | 'bigop'
  | 'atom'
  | 'word'
  | 'piecewise'
  | 'latex';

/** Options for MathModel.insert(); a plain string is accepted for 'latex'. */
export type InsertOptions =
  | string
  | {
      type?: string;
      open?: string;
      op?: string;
      text?: string;
      latex?: string;
      cls?: AtomClass;
      name?: string;
    };
