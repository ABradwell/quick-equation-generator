// AST types shared by the parser, evaluator, renderer, graph and code generators.
// The format is documented in docs/AST.md.

export type BinaryOp = '+' | '-' | '*' | '/' | '^';
export type CompareOp = '<' | '>' | '<=' | '>=' | '==';
export type ConstantName = 'pi' | 'tau' | 'e';

export interface NumNode {
  type: 'num';
  value: number;
}
export interface ConstNode {
  type: 'const';
  name: ConstantName;
}
export interface VarNode {
  type: 'var';
  name: string;
}
export interface NegNode {
  type: 'neg';
  arg: Node;
}
export interface BinNode {
  type: 'bin';
  op: BinaryOp;
  left: Node;
  right: Node;
}
export interface CallNode {
  type: 'call';
  fn: string;
  args: Node[];
}
export interface LoopNode {
  type: 'sum' | 'prod';
  index: string;
  from: Node;
  to: Node;
  body: Node;
}
export interface PiecewiseCase {
  cond: Node;
  value: Node;
}
export interface PiecewiseNode {
  type: 'piecewise';
  cases: PiecewiseCase[];
  otherwise: Node | null;
}
export interface CmpNode {
  type: 'cmp';
  op: CompareOp;
  left: Node;
  right: Node;
}
export interface AndNode {
  type: 'and';
  args: CmpNode[];
}

export type Node =
  | NumNode
  | ConstNode
  | VarNode
  | NegNode
  | BinNode
  | CallNode
  | LoopNode
  | PiecewiseNode
  | CmpNode
  | AndNode;

export type DefinitionKind = 'function' | 'assignment' | 'implicit' | 'expression';

/** What parseEquation() returns. */
export interface Definition {
  name: string;
  params: string[];
  body: Node;
  kind: DefinitionKind;
  warnings: string[];
}

/** Variable bindings for evaluate(). */
export type Env = Record<string, number>;
