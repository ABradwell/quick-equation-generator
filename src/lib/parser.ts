// Math notation parser: Desmos / LaTeX / plain-ASCII input -> AST.
// The AST format is documented in docs/AST.md. Runs in Node and the browser.
import type {
  BinaryOp,
  CmpNode,
  CompareOp,
  ConstantName,
  Definition,
  DefinitionKind,
  Node,
  PiecewiseCase,
} from './ast.ts';

export class ParseError extends Error {
  pos: number;

  constructor(message: string, pos = -1) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

const GREEK = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'omicron',
  'rho',
  'sigma',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Sigma',
  'Phi',
  'Psi',
  'Omega',
];

const UNICODE_GREEK: Record<string, string> = {
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

// Function words as typed -> canonical name used while parsing.
const FUNCTION_WORDS: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  sec: 'sec',
  csc: 'csc',
  cot: 'cot',
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  asin: 'asin',
  acos: 'acos',
  atan: 'atan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  asinh: 'asinh',
  acosh: 'acosh',
  atanh: 'atanh',
  arsinh: 'asinh',
  arcosh: 'acosh',
  artanh: 'atanh',
  atan2: 'atan2',
  exp: 'exp',
  ln: 'ln',
  log: 'log',
  sqrt: 'sqrt',
  cbrt: 'cbrt',
  abs: 'abs',
  floor: 'floor',
  ceil: 'ceil',
  round: 'round',
  sign: 'sign',
  sgn: 'sign',
  min: 'min',
  max: 'max',
  mod: 'mod',
};

const ARITY: Record<string, [number, number]> = {
  atan2: [2, 2],
  min: [2, Infinity],
  max: [2, Infinity],
  mod: [2, 2],
};

const INVERSE: Record<string, string> = {
  sin: 'asin',
  cos: 'acos',
  tan: 'atan',
  sinh: 'asinh',
  cosh: 'acosh',
  tanh: 'atanh',
};

const CONSTANTS: Record<string, ConstantName> = { pi: 'pi', tau: 'tau', e: 'e' };

// Words recognised inside a run of letters, longest first, so "sinx" -> sin x.
const WORDS = [...Object.keys(FUNCTION_WORDS), ...GREEK, 'pi', 'tau', 'sum', 'prod'].sort(
  (a, b) => b.length - a.length,
);

const COMMAND_OPS: Record<string, string> = {
  cdot: '*',
  times: '*',
  ast: '*',
  div: '/',
  le: '<=',
  leq: '<=',
  ge: '>=',
  geq: '>=',
  lt: '<',
  gt: '>',
};
const SKIP_COMMANDS = new Set(['left', 'right', 'displaystyle', 'quad', 'qquad', 'big', 'Big']);

// ---------------------------------------------------------------- lexer

interface Token {
  /** Token kind: 'num', 'name', 'fn', 'const', 'bigop', 'op', 'frac', 'sqrt', 'eof' or a punctuation character. */
  t: string;
  v: string;
  pos: number;
}

function lex(src: string, extraWords: string[] = []): Token[] {
  const words = extraWords.length
    ? [...new Set([...extraWords, ...WORDS])].sort((a, b) => b.length - a.length)
    : WORDS;
  const extra = new Set(extraWords);
  const tokens: Token[] = [];
  let i = 0;
  const push = (t: string, v: string, pos: number) => tokens.push({ t, v, pos });

  const pushWord = (word: string, pos: number) => {
    if (extra.has(word)) push('name', word, pos);
    else if (word in FUNCTION_WORDS) push('fn', FUNCTION_WORDS[word], pos);
    else if (word in CONSTANTS) push('const', CONSTANTS[word], pos);
    else if (word === 'sum' || word === 'prod') push('bigop', word, pos);
    else push('name', word, pos);
  };

  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      push('num', num[0], i);
      i += num[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      // Split a run of letters into known words / single letters.
      const start = i;
      while (i < src.length && /[A-Za-z]/.test(src[i])) {
        const word = words.find((w) => src.startsWith(w, i));
        if (word) {
          pushWord(word, i);
          i += word.length;
        } else {
          pushWord(src[i], i);
          i++;
        }
      }
      if (i === start) i++;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (!m) {
        const next = src[i + 1];
        if (next === '{' || next === '}') push(next, next, i);
        else if (next === '|') push('|', '|', i);
        else if (!/[,;:! ]/.test(next ?? ''))
          throw new ParseError(`Unexpected "\\${next ?? ''}"`, i);
        i += 2;
        continue;
      }
      const cmd = m[1];
      const pos = i;
      i += m[0].length;
      if (SKIP_COMMANDS.has(cmd)) continue;
      if (cmd in COMMAND_OPS) push('op', COMMAND_OPS[cmd], pos);
      else if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') push('frac', 'frac', pos);
      else if (cmd === 'sqrt') push('sqrt', 'sqrt', pos);
      else if (cmd === 'sum' || cmd === 'prod') push('bigop', cmd, pos);
      else if (cmd === 'operatorname' || cmd === 'mathrm' || cmd === 'text') {
        const body = /^\s*\{\s*([A-Za-z0-9]+)\s*\}/.exec(src.slice(i));
        if (!body) throw new ParseError(`Expected {name} after \\${cmd}`, pos);
        i += body[0].length;
        if (!(body[1] in FUNCTION_WORDS) && cmd === 'operatorname') {
          throw new ParseError(`Unknown function "${body[1]}"`, pos);
        }
        pushWord(body[1], pos);
      } else if (cmd in FUNCTION_WORDS || cmd in CONSTANTS || GREEK.includes(cmd)) {
        pushWord(
          cmd === 'varepsilon'
            ? 'epsilon'
            : cmd === 'vartheta'
              ? 'theta'
              : cmd === 'varphi'
                ? 'phi'
                : cmd,
          pos,
        );
      } else {
        throw new ParseError(`Unknown command "\\${cmd}"`, pos);
      }
      continue;
    }
    if (c in UNICODE_GREEK) {
      push('name', UNICODE_GREEK[c], i++);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=') {
      push('op', two, i);
      i += 2;
      continue;
    }
    if (two === '**') {
      push('op', '^', i);
      i += 2;
      continue;
    }
    const single: Record<string, string> = {
      '+': '+',
      '-': '-',
      '−': '-',
      '*': '*',
      '·': '*',
      '×': '*',
      '∙': '*',
      '/': '/',
      '÷': '/',
      '^': '^',
      '<': '<',
      '>': '>',
      '≤': '<=',
      '≥': '>=',
      '=': '=',
    };
    if (c in single) {
      push('op', single[c], i++);
      continue;
    }
    if (c === 'π') {
      push('const', 'pi', i++);
      continue;
    }
    if (c === 'τ') {
      push('const', 'tau', i++);
      continue;
    }
    if (c === '√') {
      push('sqrt', 'sqrt', i++);
      continue;
    }
    if ('()[]{}|,:_'.includes(c)) {
      push(c, c, i++);
      continue;
    }
    throw new ParseError(`Unexpected character "${c}"`, i);
  }
  tokens.push({ t: 'eof', v: '', pos: src.length });
  return tokens;
}

// --------------------------------------------------------------- helpers

const num = (value: number): Node => ({ type: 'num', value });
const bin = (op: string, left: Node, right: Node): Node => ({
  type: 'bin',
  op: op as BinaryOp,
  left,
  right,
});
const call = (fn: string, ...args: Node[]): Node => ({ type: 'call', fn, args });
const CMP_OPS = new Set(['<', '>', '<=', '>=', '=']);

// ---------------------------------------------------------------- parser

class Parser {
  tokens: Token[];
  i: number;
  absDepth: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.i = 0;
    this.absDepth = 0;
  }

  peek(offset = 0): Token {
    return this.tokens[this.i + offset];
  }

  next(): Token {
    return this.tokens[this.i++];
  }

  is(t: string, v?: string): boolean {
    const tok = this.peek();
    return tok.t === t && (v === undefined || tok.v === v);
  }

  isOp(v: string): boolean {
    return this.is('op', v);
  }

  expect(t: string, v?: string): Token {
    const tok = this.peek();
    if (tok.t !== t || (v !== undefined && tok.v !== v)) {
      const want = v ?? t;
      const got = tok.t === 'eof' ? 'end of input' : `"${tok.v}"`;
      throw new ParseError(`Expected "${want}" but found ${got}`, tok.pos);
    }
    return this.next();
  }

  // Does the current token start a factor that can be implicitly multiplied?
  startsImplicit({ allowFn = true }: { allowFn?: boolean } = {}): boolean {
    const tok = this.peek();
    switch (tok.t) {
      case 'num':
      case 'name':
      case 'const':
      case 'frac':
      case 'sqrt':
      case '(':
      case '[':
      case '{':
        return true;
      case 'fn':
      case 'bigop':
        return allowFn;
      case '|':
        return this.absDepth === 0;
      default:
        return false;
    }
  }

  parseExpression(): Node {
    let left = this.parseTerm();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().v;
      left = bin(op, left, this.parseTerm());
    }
    return left;
  }

  parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = this.next().v;
        left = bin(op, left, this.parseUnary());
      } else if (this.startsImplicit()) {
        left = bin('*', left, this.parsePower());
      } else {
        return left;
      }
    }
  }

  parseUnary(): Node {
    if (this.isOp('-')) {
      this.next();
      return { type: 'neg', arg: this.parseUnary() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  parsePower(): Node {
    const base = this.parsePrimary();
    if (this.isOp('^')) {
      this.next();
      return bin('^', base, this.parseExponent());
    }
    return base;
  }

  // Exponent: a braced group, or a (signed) primary that may itself be raised.
  parseExponent(): Node {
    if (this.isOp('-')) {
      this.next();
      return { type: 'neg', arg: this.parseExponent() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.parseExponent();
    }
    return this.parsePower();
  }

  parseGroup(open: string, close: string): Node {
    this.expect(open);
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    const e = this.parseExpression();
    this.absDepth = savedAbs;
    this.expect(close);
    return e;
  }

  parsePrimary(): Node {
    const tok = this.peek();
    switch (tok.t) {
      case 'num':
        this.next();
        return num(Number(tok.v));
      case 'const':
        this.next();
        return { type: 'const', name: tok.v as ConstantName };
      case 'name':
        this.next();
        return { type: 'var', name: tok.v + this.parseNameSubscript() };
      case '(':
        return this.parseGroup('(', ')');
      case '[':
        return this.parseGroup('[', ']');
      case '{':
        return this.parseBraceOrPiecewise();
      case '|': {
        this.next();
        this.absDepth++;
        const e = this.parseExpression();
        this.absDepth--;
        this.expect('|');
        return call('abs', e);
      }
      case 'frac': {
        this.next();
        const n = this.parseGroup('{', '}');
        const d = this.parseGroup('{', '}');
        return bin('/', n, d);
      }
      case 'sqrt':
        return this.parseSqrt();
      case 'fn':
        return this.parseFunction();
      case 'bigop':
        return this.parseBigOp();
      case 'eof':
        throw new ParseError('Unexpected end of input', tok.pos);
      default:
        throw new ParseError(`Unexpected "${tok.v}"`, tok.pos);
    }
  }

  // x_1, x_{12}, x_a, x_{max}
  parseNameSubscript(): string {
    if (!this.is('_')) return '';
    this.next();
    if (this.is('{')) {
      this.next();
      let sub = '';
      while (!this.is('}')) {
        const tok = this.next();
        if (!['num', 'name', 'fn', 'const', 'bigop'].includes(tok.t) || tok.v.includes('.')) {
          throw new ParseError('Subscripts may only contain letters and digits', tok.pos);
        }
        sub += tok.v;
      }
      this.next();
      if (!sub) throw new ParseError('Empty subscript', this.peek().pos);
      return `_${sub}`;
    }
    const tok = this.next();
    if (tok.t === 'num' && /^\d+$/.test(tok.v)) return `_${tok.v}`;
    if (tok.t === 'name' || tok.t === 'const') return `_${tok.v}`;
    throw new ParseError('Invalid subscript', tok.pos);
  }

  parseSqrt(): Node {
    this.next();
    let index: Node | null = null;
    if (this.is('[')) index = this.parseGroup('[', ']');
    let arg: Node;
    if (this.is('{')) arg = this.parseGroup('{', '}');
    else if (this.is('(')) arg = this.parseGroup('(', ')');
    else arg = this.parsePower();
    if (!index) return call('sqrt', arg);
    if (index.type === 'num' && index.value === 2) return call('sqrt', arg);
    if (index.type === 'num' && index.value === 3) return call('cbrt', arg);
    return bin('^', arg, bin('/', num(1), index));
  }

  parseFunction(): Node {
    const tok = this.next();
    let fn = tok.v;
    let base: Node | null = null;
    let power: Node | null = null;

    if (fn === 'log' && this.is('_')) {
      this.next();
      base = this.is('{') ? this.parseGroup('{', '}') : this.parsePrimary();
    }
    if (this.isOp('^')) {
      this.next();
      power = this.is('{') ? this.parseGroup('{', '}') : this.parseExponent();
      const isMinusOne = power.type === 'neg' && power.arg.type === 'num' && power.arg.value === 1;
      if (isMinusOne && fn in INVERSE) {
        fn = INVERSE[fn];
        power = null;
      }
    }

    let args: Node[];
    if (this.is('(')) {
      this.next();
      const savedAbs = this.absDepth;
      this.absDepth = 0;
      args = [this.parseExpression()];
      while (this.is(',')) {
        this.next();
        args.push(this.parseExpression());
      }
      this.absDepth = savedAbs;
      this.expect(')');
    } else if (this.is('{') && fn === 'sqrt') {
      args = [this.parseGroup('{', '}')];
    } else {
      // Desmos-style "sin 2x": the argument runs until an operator or another function.
      if (!this.startsImplicit({ allowFn: false }) && !this.isOp('-')) {
        throw new ParseError(`Expected an argument after "${tok.v}"`, this.peek().pos);
      }
      let arg: Node = this.isOp('-')
        ? (this.next(), { type: 'neg', arg: this.parsePower() })
        : this.parsePower();
      while (this.startsImplicit({ allowFn: false })) arg = bin('*', arg, this.parsePower());
      args = [arg];
    }

    const [lo, hi] = ARITY[fn] ?? [1, 1];
    if (args.length < lo || args.length > hi) {
      const expected = lo === hi ? `${lo}` : hi === Infinity ? `at least ${lo}` : `${lo}-${hi}`;
      throw new ParseError(`${tok.v} takes ${expected} argument(s), got ${args.length}`, tok.pos);
    }

    let result: Node;
    const [a, b] = args;
    switch (fn) {
      case 'sec':
        result = bin('/', num(1), call('cos', a));
        break;
      case 'csc':
        result = bin('/', num(1), call('sin', a));
        break;
      case 'cot':
        result = bin('/', num(1), call('tan', a));
        break;
      case 'log':
        result = base ? bin('/', call('ln', a), call('ln', base)) : call('log10', a);
        break;
      case 'round':
        result = call('floor', bin('+', a, num(0.5)));
        break;
      case 'mod':
        result = bin('-', a, bin('*', b, call('floor', bin('/', a, b))));
        break;
      default:
        result = call(fn, ...args);
    }
    return power ? bin('^', result, power) : result;
  }

  // \sum_{n=1}^{10} body  |  sum_(n=1)^N body
  parseBigOp(): Node {
    const tok = this.next();
    this.expect('_');
    const close = this.is('{') ? '}' : this.is('(') ? ')' : null;
    if (!close) throw new ParseError(`Expected {n=...} after ${tok.v}`, this.peek().pos);
    this.next();
    const idxTok = this.expect('name');
    const index = idxTok.v + this.parseNameSubscript();
    this.expect('op', '=');
    const from = this.parseExpression();
    this.expect(close);
    this.expect('op', '^');
    const to = this.is('{') ? this.parseGroup('{', '}') : this.parseExponent();
    const body = this.parseTerm();
    return { type: tok.v as 'sum' | 'prod', index, from, to, body };
  }

  // { expr }  or Desmos piecewise { cond: value, cond: value, default }
  parseBraceOrPiecewise(): Node {
    this.expect('{');
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    const first = this.parseExpression();
    if (this.is('}')) {
      this.next();
      this.absDepth = savedAbs;
      return first;
    }
    const cases: PiecewiseCase[] = [];
    let otherwise: Node | null = null;
    let expr = first;
    for (;;) {
      if (this.peek().t === 'op' && CMP_OPS.has(this.peek().v)) {
        const cond = this.parseCondition(expr);
        let value = num(1);
        if (this.is(':')) {
          this.next();
          value = this.parseExpression();
        }
        cases.push({ cond, value });
      } else {
        if (cases.length === 0) {
          throw new ParseError('Expected a condition like x<0 inside { }', this.peek().pos);
        }
        otherwise = expr;
        if (!this.is('}'))
          throw new ParseError('The default value must come last', this.peek().pos);
      }
      if (this.is('}')) break;
      this.expect(',');
      expr = this.parseExpression();
    }
    this.next();
    this.absDepth = savedAbs;
    return { type: 'piecewise', cases, otherwise };
  }

  parseCondition(left: Node): Node {
    const parts: CmpNode[] = [];
    while (this.peek().t === 'op' && CMP_OPS.has(this.peek().v)) {
      const op = this.next().v;
      const right = this.parseExpression();
      parts.push({ type: 'cmp', op: (op === '=' ? '==' : op) as CompareOp, left, right });
      left = right;
    }
    return parts.length === 1 ? parts[0] : { type: 'and', args: parts };
  }
}

// --------------------------------------------------------------- public API

function normalize(src: string): string {
  return src
    .replace(/\\(left|right)(?![A-Za-z])/g, '')
    .replace(/[\u0370-\u03ff]/g, (c) => (c in UNICODE_GREEK ? `\\${UNICODE_GREEK[c]} ` : c))
    .trim();
}

const LHS_NAME = String.raw`\\?([A-Za-z][A-Za-z0-9]*(?:_\{?[A-Za-z0-9]+\}?)?)`;
const FN_DEF_RE = new RegExp(String.raw`^${LHS_NAME}\s*\(([^()=]*)\)\s*=(?!=)`);
const ASSIGN_RE = new RegExp(String.raw`^${LHS_NAME}\s*=(?!=)`);

// A left-hand-side name is usable unless it is a function/constant, or a
// backslash command that is not a Greek letter.
function usableName(match: RegExpExecArray | null): match is RegExpExecArray {
  if (!match) return false;
  const base = match[1].split('_')[0];
  if (match[0].startsWith('\\') && !GREEK.includes(base)) return false;
  return !(match[1] in FUNCTION_WORDS) && !(match[1] in CONSTANTS);
}

function parseExpr(
  src: string,
  offset = 0,
  extraWords: string[] = [],
): { left: Node; right: Node | null } {
  let tokens: Token[];
  try {
    tokens = lex(src, extraWords);
  } catch (err) {
    if (err instanceof ParseError && err.pos >= 0) err.pos += offset;
    throw err;
  }
  tokens.forEach((t) => (t.pos += offset));
  const p = new Parser(tokens);
  const left = p.parseExpression();
  let right: Node | null = null;
  if (p.isOp('=')) {
    p.next();
    right = p.parseExpression();
  }
  if (!p.is('eof')) {
    const tok = p.peek();
    throw new ParseError(`Unexpected "${tok.v}"`, tok.pos);
  }
  return { left, right };
}

/** Parse a single expression (no "="). */
/**
 * Parse a value typed into a number box (the Evaluate panel). Unlike in an equation, `5.972e24`
 * here is scientific notation, not 5.972·e·24.
 */
export function parseValue(src: string): Node {
  const text = src.replace(
    /(?<![\w.])(\d+\.?\d*|\.\d+)[eE]([+-]?\d+)(?![\w.])/g,
    (_, mantissa: string, exponent: string) => `(${mantissa}*10^{${exponent}})`,
  );
  return parseExpression(text);
}

export function parseExpression(src: string): Node {
  const { left, right } = parseExpr(normalize(src));
  if (right) throw new ParseError('Unexpected "="');
  return left;
}

/** Free variables of an AST in order of first appearance. */
export function freeVariables(
  node: Node,
  bound: Set<string> = new Set(),
  out: string[] = [],
): string[] {
  switch (node.type) {
    case 'var':
      if (!bound.has(node.name) && !out.includes(node.name)) out.push(node.name);
      break;
    case 'bin':
    case 'cmp':
      freeVariables(node.left, bound, out);
      freeVariables(node.right, bound, out);
      break;
    case 'neg':
      freeVariables(node.arg, bound, out);
      break;
    case 'call':
    case 'and':
      node.args.forEach((a) => freeVariables(a, bound, out));
      break;
    case 'sum':
    case 'prod': {
      freeVariables(node.from, bound, out);
      freeVariables(node.to, bound, out);
      const inner = new Set(bound);
      inner.add(node.index);
      freeVariables(node.body, inner, out);
      break;
    }
    case 'piecewise':
      node.cases.forEach((c) => {
        freeVariables(c.cond, bound, out);
        freeVariables(c.value, bound, out);
      });
      if (node.otherwise) freeVariables(node.otherwise, bound, out);
      break;
    default:
      break;
  }
  return out;
}

const PARAM_ORDER = ['x', 'y', 'z', 't'];
function sortParams(vars: Iterable<string>): string[] {
  return [...vars].sort((a, b) => {
    const ia = PARAM_ORDER.indexOf(a);
    const ib = PARAM_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

function parseParamName(raw: string, pos: number): string {
  const plain = raw.trim();
  if (/^[A-Za-z]{2,}$/.test(plain) && !(plain in FUNCTION_WORDS) && !(plain in CONSTANTS)) {
    return plain;
  }
  const tokens = lex(plain);
  const p = new Parser(tokens);
  const tok = p.peek();
  if (tok.t !== 'name') throw new ParseError(`"${raw.trim()}" is not a valid parameter name`, pos);
  p.next();
  const name = tok.v + p.parseNameSubscript();
  if (!p.is('eof')) throw new ParseError(`"${raw.trim()}" is not a valid parameter name`, pos);
  return name;
}

/**
 * Parse an equation into a function definition.
 * Accepts: "f(x, y) = ...", "y = ...", "x^2 + y^2 = 1" (implicit) or a bare expression.
 * Returns { name, params, body, kind, warnings }.
 */
export function parseEquation(input: string): Definition {
  const src = normalize(input);
  if (!src) throw new ParseError('Type an equation', 0);
  const warnings: string[] = [];
  let name = 'f';
  let params: string[] | null = null;
  let body: Node;
  let kind: DefinitionKind;

  const fnDef = FN_DEF_RE.exec(src);
  const assign = ASSIGN_RE.exec(src);

  if (usableName(fnDef)) {
    name = fnDef[1].replace(/[{}]/g, '');
    params = fnDef[2].trim() ? fnDef[2].split(',').map((p) => parseParamName(p, 0)) : [];
    const dup = params.find((p, i, all) => all.indexOf(p) !== i);
    if (dup) throw new ParseError(`Parameter "${dup}" is listed twice`, 0);
    // Multi-letter parameter names (e.g. "mass") are read as one variable in the body.
    const multi = params.filter((p) => /^[A-Za-z]{2,}$/.test(p) && !GREEK.includes(p));
    const { left, right } = parseExpr(src.slice(fnDef[0].length), fnDef[0].length, multi);
    if (right) throw new ParseError('Only one "=" is allowed', fnDef[0].length);
    body = left;
    kind = 'function';
  } else if (usableName(assign)) {
    name = assign[1].replace(/[{}]/g, '');
    const { left, right } = parseExpr(src.slice(assign[0].length), assign[0].length);
    if (right) throw new ParseError('Only one "=" is allowed', assign[0].length);
    body = left;
    kind = 'assignment';
  } else {
    const { left, right } = parseExpr(src);
    if (right) {
      body = bin('-', left, right);
      kind = 'implicit';
      warnings.push(
        'Implicit equation: the function returns left side minus right side (zero on the curve).',
      );
    } else {
      body = left;
      kind = 'expression';
    }
  }

  const free = freeVariables(body);
  if (params) {
    const listed = params;
    const extra = free.filter((v) => !listed.includes(v));
    if (extra.length) {
      warnings.push(`Added parameter(s) not listed on the left: ${extra.join(', ')}`);
      params = [...params, ...sortParams(extra)];
    }
  } else {
    params = sortParams(free.filter((v) => v !== name));
    if (free.includes(name)) {
      throw new ParseError(`"${name}" cannot be defined in terms of itself`, 0);
    }
  }
  return { name, params, body, kind, warnings };
}
