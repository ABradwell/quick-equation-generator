// Helpers shared by the C-family generators (Go, Rust, Java).

import type { Definition, Node } from '../ast.ts';

/** An emitted expression: source text and its precedence. */
export interface Emitted {
  s: string;
  p: number;
}

/** A code generator: takes a parseEquation() result and returns standalone source code. */
export type Generator = (def: Definition) => string;

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

/** Constant loop bound `floor(v + 0.5)` as a float literal, or null if `node` is not a literal. */
export function literalBound(node: Node): string | null {
  if (node.type !== 'num' || !Number.isFinite(node.value)) return null;
  const v = Math.floor(node.value + 0.5);
  return `${v < 0 ? '-' : ''}${floatLiteral(v)}`;
}
