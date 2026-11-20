// Helpers shared by the C-family generators (Go, Rust, Java).

import type { Definition, Node } from '../ast.ts';
import { scientific } from '../scientific.ts';

/** An emitted expression: source text and its precedence. */
export interface Emitted {
  s: string;
  p: number;
}

/** Optional documentation for the generated function. Every field may be omitted. */
export interface GenMeta {
  /** The equation as the user wrote it. */
  source?: string;
  /** Notebook title. */
  title?: string;
  /** One sentence on what the equation computes. */
  about?: string;
  /** Description of each parameter, keyed by the parser's parameter name. */
  vars?: Record<string, string>;
  /** Worked example inputs, keyed by parameter name. */
  example?: Record<string, number>;
  /** Reference result for `example`. */
  expect?: number;
  /** What the example describes. */
  exampleNote?: string;
  /** Named constants: a numeric literal in the body equal to `value` is emitted by name. */
  constants?: Record<string, { value: number; about: string }>;
}

/** A code generator: takes a parseEquation() result and returns standalone source code. */
export type Generator = (def: Definition, meta?: GenMeta) => string;

/** Child nodes of an AST node. */
export function children(node: Node): Node[] {
  switch (node.type) {
    case 'neg':
      return [node.arg];
    case 'bin':
    case 'cmp':
      return [node.left, node.right];
    case 'call':
    case 'and':
      return node.args;
    case 'sum':
    case 'prod':
      return [node.from, node.to, node.body];
    case 'piecewise':
      return [
        ...node.cases.flatMap((c) => [c.cond, c.value]),
        ...(node.otherwise ? [node.otherwise] : []),
      ];
    default:
      return [];
  }
}

/** Visit every node in the subtree (including the root). */
export function walk(node: Node, fn: (n: Node) => void): void {
  fn(node);
  for (const c of children(node)) walk(c, fn);
}

/** True if a sum/prod appears strictly below `node`. */
export function hasNestedLoop(node: Node): boolean {
  return children(node).some((c) => {
    let found = false;
    walk(c, (n) => {
      if (n.type === 'sum' || n.type === 'prod') found = true;
    });
    return found;
  });
}

/** Every identifier mentioned by the definition (function, params, variables, indices). */
export function collectNames(def: Definition): Set<string> {
  const names = new Set<string>([def.name, ...def.params]);
  walk(def.body, (n) => {
    if (n.type === 'var') names.add(n.name);
    if (n.type === 'sum' || n.type === 'prod') names.add(n.index);
  });
  return names;
}

/** Names of variables read anywhere in the body. */
export function usedVars(body: Node): Set<string> {
  const names = new Set<string>();
  walk(body, (n) => {
    if (n.type === 'var') names.add(n.name);
  });
  return names;
}

/** Append `_` to identifiers that clash with `reserved`. */
export function safeName(name: string, reserved: ReadonlySet<string>): string {
  return reserved.has(name) ? `${name}_` : name;
}

/** Render a JS number as a floating-point literal (never an integer literal). */
export function floatLiteral(v: number): string {
  const s = String(Math.abs(v));
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

export function isNegativeNumber(node: Node): boolean {
  return node.type === 'num' && (node.value < 0 || Object.is(node.value, -0));
}

/** Returns a function producing identifiers not in `taken` (and never repeating). */
export function makeFresh(taken: ReadonlySet<string>): (base: string) => string {
  const allocated = new Set<string>();
  return (base) => {
    let name = base;
    for (let i = 1; taken.has(name) || allocated.has(name); i++) name = `${base}${i}`;
    allocated.add(name);
    return name;
  };
}

/** Parenthesize an emitted expression when its precedence is below `min`. */
export function wrap(r: Emitted, min: number): string {
  return r.p < min ? `(${r.s})` : r.s;
}

export const PREC = { LOWEST: 0, TERNARY: 1, AND: 2, CMP: 3, ADD: 5, MUL: 6, UNARY: 8, ATOM: 10 };

export function docComment(name: string, params: string[]): string {
  return params.length
    ? `${name} computes the equation for (${params.join(', ')}).`
    : `${name} computes the equation.`;
}

/** How parameters are written in a doc comment. */
export type ParamStyle = 'google' | 'jsdoc' | 'plain';

const splitLines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trimEnd());

/** Greedy word wrap; text that is already short, or has no spaces, is left alone. */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Plain-text lines for the doc comment of a generated function, without any comment syntax.
 * `fname` and `params` are the emitted (possibly renamed) names; `params` is parallel to
 * `def.params`. Returns null when there is nothing to say beyond the signature.
 */

/** A number for a comment: at most 6 significant digits, exponent form past 1e6 or below 1e-3. */
function exampleNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (v !== 0 && (abs >= 1e6 || abs < 1e-3)) return v.toExponential(3).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(6)));
}

export function docLines(
  def: Definition,
  meta: GenMeta | undefined,
  fname: string,
  params: string[],
  style: ParamStyle,
): string[] | null {
  const source = meta?.source?.trim();
  const title = meta?.title?.trim();
  if (!source && !title) return null;
  const out: string[] = [];
  const para = (lines: string[]) => {
    if (out.length) out.push('');
    out.push(...lines);
  };
  if (title) para(splitLines(title));
  const about = meta?.about?.trim();
  if (title && about) para(wrapText(about, 80));
  if (source) {
    const src = splitLines(source);
    para(src.length === 1 ? [`Equation: ${src[0]}`] : ['Equation:', ...src.map((l) => `  ${l}`)]);
  }

  // Parameter descriptions and the worked example only accompany notebook metadata.
  const vars = title ? (meta?.vars ?? {}) : {};
  const paramLines = def.params.flatMap((orig, i) => {
    const desc = vars[orig]?.replace(/\s+/g, ' ').trim();
    if (!desc) return [];
    const renamed = params[i] !== orig ? ` (the equation's ${orig})` : '';
    return [
      style === 'jsdoc'
        ? `@param ${params[i]} ${desc}${renamed}`
        : `${params[i]}: ${desc}${renamed}`,
    ];
  });

  let example: string | null = null;
  if (title && meta?.example && typeof meta.expect === 'number') {
    const args = def.params.map((p) => exampleNumber(meta.example![p]));
    if (args.every((a) => a !== 'undefined')) {
      const note = meta.exampleNote?.replace(/\s+/g, ' ').trim();
      example = `Example: ${fname}(${args.join(', ')}) ≈ ${exampleNumber(meta.expect)}${note ? ` (${note})` : ''}`;
    }
  }

  // JSDoc and Javadoc tags must close the comment, so the example comes first there.
  if (style === 'jsdoc') {
    if (example) para([example]);
    if (paramLines.length) para(paramLines);
  } else {
    if (paramLines.length)
      para(style === 'google' ? ['Args:', ...paramLines.map((l) => `    ${l}`)] : paramLines);
    if (example) para([example]);
  }
  return out;
}

/** Prefix each line with a line-comment marker (`//`, `///`); blank lines get no trailing space. */
export function lineComment(marker: string, lines: string[]): string {
  return lines.map((l) => (l ? `${marker} ${l}` : marker)).join('\n');
}

/** A JSDoc block comment; any closing marker inside the text is broken so it cannot end early. */
export function blockComment(lines: string[], indent = ''): string {
  const body = lines.map((l) => {
    const safe = l.replace(/\*\//g, '* /');
    return safe ? `${indent} * ${safe}` : `${indent} *`;
  });
  return [`${indent}/**`, ...body, `${indent} */`].join('\n');
}

/** Constant loop bound `floor(v + 0.5)` as a float literal, or null if `node` is not a literal. */
export function literalBound(node: Node): string | null {
  if (node.type !== 'num' || !Number.isFinite(node.value)) return null;
  const v = Math.floor(node.value + 0.5);
  return `${v < 0 ? '-' : ''}${floatLiteral(v)}`;
}

/** Rebuild a node with `fn` applied to each child. `skipBounds` leaves sum/prod bounds alone. */
function mapChildren(node: Node, fn: (n: Node) => Node, skipBounds = false): Node {
  switch (node.type) {
    case 'neg':
      return { ...node, arg: fn(node.arg) };
    case 'bin':
    case 'cmp':
      return { ...node, left: fn(node.left), right: fn(node.right) };
    case 'call':
      return { ...node, args: node.args.map(fn) };
    case 'and':
      return { ...node, args: node.args.map((a) => fn(a) as typeof a) };
    case 'sum':
    case 'prod':
      return {
        ...node,
        from: skipBounds ? node.from : fn(node.from),
        to: skipBounds ? node.to : fn(node.to),
        body: fn(node.body),
      };
    case 'piecewise':
      return {
        ...node,
        cases: node.cases.map((c) => ({ cond: fn(c.cond), value: fn(c.value) })),
        otherwise: node.otherwise ? fn(node.otherwise) : null,
      };
    default:
      return node;
  }
}

/**
 * Replace every `m * 10 ^ n` (literal mantissa, literal integer exponent, see scientific.ts) with
 * the single literal `m e n`. The result is a plain number node, so it is an atom wherever it lands.
 */
export function foldScientific(node: Node): Node {
  const sci = scientific(node);
  if (!sci) return mapChildren(node, foldScientific);
  const lit: Node =
    sci.value < 0
      ? { type: 'neg', arg: { type: 'num', value: -sci.value } }
      : { type: 'num', value: sci.value };
  return sci.rest ? { type: 'bin', op: '*', left: foldScientific(sci.rest), right: lit } : lit;
}

/** A declared constant that the body uses, ready to be emitted before the function. */
export interface NamedConstant {
  name: string;
  value: number;
  about: string;
}

/** True if two numbers agree to a relative 1e-9. */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.abs(b);

/**
 * Prepare a definition for emission: fold scientific notation, then replace numeric literals
 * that match a declared constant with a variable of that name. `isReserved` says whether a name
 * would be renamed or rejected by the language; such constants, and any whose name is already
 * used by the function, its parameters or loop indices, stay as literals. Literals used as
 * sum/prod bounds are never replaced.
 */
export function prepareDefinition(
  def: Definition,
  meta: GenMeta | undefined,
  isReserved: (name: string) => boolean,
): { def: Definition; constants: NamedConstant[] } {
  let body = foldScientific(def.body);
  const taken = collectNames({ ...def, body });
  const declared = Object.entries(meta?.constants ?? {}).filter(
    ([name, c]) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      Number.isFinite(c.value) &&
      c.value > 0 &&
      !taken.has(name) &&
      !isReserved(name),
  );
  const used = new Map<string, NamedConstant>();
  const replace = (n: Node): Node => {
    if (n.type === 'num') {
      for (const [name, c] of declared) {
        if (!sameValue(n.value, c.value)) continue;
        used.set(name, { name, value: c.value, about: c.about.replace(/\s+/g, ' ').trim() });
        return { type: 'var', name };
      }
      return n;
    }
    return mapChildren(n, replace, true);
  };
  if (declared.length) body = replace(body);
  const constants = declared.flatMap(([name]) => used.get(name) ?? []);
  return { def: { ...def, body }, constants };
}
