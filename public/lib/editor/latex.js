// Serialise the editor tree to LaTeX that parser.js accepts, and import LaTeX / ASCII math
// (as accepted by parser.js) back into a tree. No DOM.
import {
  CLOSE_OF,
  CONSTANTS,
  GREEK,
  GREEK_BY_CHAR,
  IMPORT_FUNCTIONS,
  constAtom,
  fnAtom,
  greekAtom,
  makeAtom,
  makeBigop,
  makeBlock,
  makeFrac,
  makeParen,
  makeScript,
  makeSqrt,
} from './tree.js';

// ------------------------------------------------------------------ toLatex

// A command such as "\pi" must not run into a following letter ("\pix").
function join(a, b) {
  if (a && b && /\\[A-Za-z]+$/.test(a) && /^[A-Za-z]/.test(b)) return `${a} ${b}`;
  return a + b;
}

// Can a one-character script drop its braces without merging with what follows?
function bareScript(item, next) {
  if (item?.kind !== 'atom') return false;
  const isDigit = item.cls === 'num' && /^[0-9]$/.test(item.latex);
  const isLetter = item.cls === 'var' && /^[A-Za-z]$/.test(item.latex);
  if (!isDigit && !isLetter) return false;
  if (next?.kind === 'atom') {
    if (isDigit && next.cls === 'num') return false;
    if (isLetter && next.cls === 'var' && /^[A-Za-z]$/.test(next.latex)) return false;
  }
  return true;
}

function script(symbol, node, next) {
  const items = node.blocks[0].items;
  if (items.length === 1 && bareScript(items[0], next)) return symbol + items[0].latex;
  return `${symbol}{${serialize(items)}}`;
}

function serializeItem(item, next) {
  switch (item.kind) {
    case 'atom':
      return item.latex;
    case 'frac':
      return `\\frac{${serialize(item.blocks[0].items)}}{${serialize(item.blocks[1].items)}}`;
    case 'sup':
      return script('^', item, next);
    case 'sub':
      return script('_', item, next);
    case 'sqrt': {
      const arg = serialize(item.blocks[0].items);
      return item.index ? `\\sqrt[${serialize(item.index.items)}]{${arg}}` : `\\sqrt{${arg}}`;
    }
    case 'paren': {
      const inner = serialize(item.blocks[0].items);
      const esc = (c) => (c === '{' || c === '}' ? `\\${c}` : c);
      return `\\left${esc(item.open)}${inner}\\right${esc(item.close)}`;
    }
    case 'bigop':
      return (
        `\\${item.op}_{${serialize(item.blocks[0].items)}}` +
        `^{${serialize(item.blocks[1].items)}}`
      );
    default:
      return '';
  }
}

function serialize(items) {
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = items[i + 1];
    // "x^2_1" is not valid input for the parser; always write the subscript first.
    if (item.kind === 'sup' && next?.kind === 'sub') {
      const sub = next;
      out = join(out, serializeItem(sub, item));
      out = join(out, serializeItem(item, items[i + 2]));
      i++;
      continue;
    }
    out = join(out, serializeItem(item, next));
  }
  return out;
}

/** LaTeX for a block, or for an array of items (e.g. a selection). */
export function toLatex(target) {
  return serialize(Array.isArray(target) ? target : target.items);
}

// ---------------------------------------------------------------- fromLatex

class ImportError extends Error {}

const WORD_LIST = [
  ...IMPORT_FUNCTIONS,
  ...Object.keys(GREEK),
  ...Object.keys(CONSTANTS),
  'sum',
  'prod',
  'sqrt',
];
const FUNCTION_SET = new Set(IMPORT_FUNCTIONS);

const COMMAND_OPS = {
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
const SKIP_COMMANDS = new Set(['displaystyle', 'quad', 'qquad', 'big', 'Big']);

const SINGLE_OPS = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '·': '*',
  '×': '*',
  '∙': '*',
  '/': '/',
  '÷': '/',
  '<': '<',
  '>': '>',
  '≤': '<=',
  '≥': '>=',
  '=': '=',
};

function classifyWord(word, extra) {
  if (extra.has(word)) return { t: 'extra', v: word };
  if (word === 'sqrt') return { t: 'sqrtw' };
  if (FUNCTION_SET.has(word)) return { t: 'fn', v: word };
  if (word in CONSTANTS) return { t: 'const', v: word };
  if (word === 'sum' || word === 'prod') return { t: 'bigop', v: word };
  if (word in GREEK) return { t: 'greek', v: word };
  if (word.length === 1) return { t: 'letter', v: word };
  return { t: 'name', v: word };
}

function lex(src, extraWords) {
  const extra = new Set(extraWords);
  const words = [...new Set([...extraWords, ...WORD_LIST])].sort((a, b) => b.length - a.length);
  const tokens = [];
  const push = (t, v) => tokens.push({ t, v });
  const numRe = /(\d+(\.\d*)?|\.\d+)/y;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    numRe.lastIndex = i;
    const num = numRe.exec(src);
    if (num) {
      push('num', num[0]);
      i += num[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      while (i < src.length && /[A-Za-z]/.test(src[i])) {
        const word = words.find((w) => src.startsWith(w, i)) ?? src[i];
        const tok = classifyWord(word, extra);
        tokens.push(tok);
        i += word.length;
      }
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (!m) {
        const next = src[i + 1];
        if (next === '{' || next === '}' || next === '|') push(next, next);
        else if (!/[,;:! ]/.test(next ?? '')) throw new ImportError(`Unexpected "\\${next ?? ''}"`);
        i += 2;
        continue;
      }
      const cmd = m[1];
      i += m[0].length;
      if (SKIP_COMMANDS.has(cmd)) continue;
      if (cmd === 'left' || cmd === 'right') push(cmd);
      else if (cmd in COMMAND_OPS) push('op', COMMAND_OPS[cmd]);
      else if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') push('frac');
      else if (cmd === 'sqrt') push('sqrt');
      else if (cmd === 'sum' || cmd === 'prod') push('bigop', cmd);
      else if (cmd === 'operatorname' || cmd === 'mathrm' || cmd === 'text') {
        const body = /^\s*\{\s*([A-Za-z0-9]+)\s*\}/.exec(src.slice(i));
        if (!body) throw new ImportError(`Expected {name} after \\${cmd}`);
        i += body[0].length;
        const tok = classifyWord(body[1], new Set());
        if (cmd === 'operatorname' && tok.t !== 'fn' && tok.t !== 'sqrtw') {
          throw new ImportError(`Unknown function "${body[1]}"`);
        }
        tokens.push(tok);
      } else if (cmd in GREEK) push('greek', cmd);
      else if (FUNCTION_SET.has(cmd)) push('fn', cmd);
      else if (cmd in CONSTANTS) push('const', cmd);
      else throw new ImportError(`Unknown command "\\${cmd}"`);
      continue;
    }
    if (c in GREEK_BY_CHAR) {
      push('greek', GREEK_BY_CHAR[c]);
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=') {
      push('op', two);
      i += 2;
      continue;
    }
    if (two === '**') {
      push('^', '^');
      i += 2;
      continue;
    }
    if (c in SINGLE_OPS) push('op', SINGLE_OPS[c]);
    else if (c === 'π') push('const', 'pi');
    else if (c === 'τ') push('const', 'tau');
    else if (c === '√') push('sqrt');
    else if ('()[]{}|,:!^_'.includes(c)) push(c, c);
    else throw new ImportError(`Unexpected character "${c}"`);
    i++;
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

const OP_ATOMS = {
  '+': ['+', '+'],
  '-': ['−', '-'],
  '*': ['·', '\\cdot'],
  '/': ['/', '/'],
  '<': ['<', '<'],
  '>': ['>', '>'],
  '=': ['=', '='],
  '<=': ['≤', '\\le'],
  '>=': ['≥', '\\ge'],
};
const opAtom = (op) => makeAtom(OP_ATOMS[op][0], OP_ATOMS[op][1], 'op');

const IMPLICIT_START = new Set([
  'num',
  'letter',
  'name',
  'extra',
  'greek',
  'const',
  'frac',
  'sqrt',
]);
const BRACKETS = new Set(['(', '[', '{']);
const SCRIPT_START = new Set([...IMPLICIT_START, 'fn', 'bigop', 'sqrtw', 'left', '|', ...BRACKETS]);
const BLOCK_OPEN = { '(': ')', '[': ']', '{': '}' };

function prevIsOperand(items) {
  const last = items[items.length - 1];
  if (!last) return false;
  if (last.kind === 'atom') return ['var', 'num', 'const', 'greek'].includes(last.cls);
  return last.kind !== 'bigop';
}

class Importer {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  peek() {
    return this.tokens[this.i];
  }

  next() {
    return this.tokens[this.i++];
  }

  fail(message) {
    throw new ImportError(message);
  }

  expect(t) {
    const tok = this.peek();
    if (tok.t !== t) {
      this.fail(
        `Expected "${t}" but found ${tok.t === 'eof' ? 'end of input' : `"${tok.v ?? tok.t}"`}`,
      );
    }
    return this.next();
  }

  // Parse items until the `end` token (left unconsumed). end: null | ')' | ']' | '}' | '|' | 'right'
  seq(end) {
    const items = [];
    for (;;) {
      const tok = this.peek();
      if (tok.t === 'eof') {
        if (end === null) return items;
        this.fail('Unbalanced brackets');
      }
      if (end === '|' ? tok.t === '|' && prevIsOperand(items) : tok.t === end) return items;
      if (tok.t === ')' || tok.t === ']' || tok.t === '}' || tok.t === 'right') {
        this.fail(`Unbalanced "${tok.v ?? '\\right'}"`);
      }
      if (tok.t === '^' || tok.t === '_') {
        this.next();
        items.push(makeScript(tok.t === '^' ? 'sup' : 'sub', this.scriptArg(tok.t === '^')));
      } else {
        this.primary(items);
      }
    }
  }

  group(end) {
    const items = this.seq(end);
    this.expect(end);
    return items;
  }

  // The argument of ^ or _ : a braced group or a single primary (with its own ^ chain).
  scriptArg(isExponent) {
    if (this.peek().t === '{') {
      this.next();
      return this.group('}');
    }
    const out = [];
    if (isExponent) {
      while (this.peek().t === 'op' && (this.peek().v === '-' || this.peek().v === '+')) {
        out.push(opAtom(this.next().v));
      }
    }
    if (!SCRIPT_START.has(this.peek().t)) {
      this.fail(isExponent ? 'Expected an exponent' : 'Expected a subscript');
    }
    this.primary(out);
    if (isExponent && this.peek().t === '^') {
      this.next();
      out.push(makeScript('sup', this.scriptArg(true)));
    }
    return out;
  }

  // sum_{n=1}^{N}: lower/upper may be {..}, (..) or a single token.
  bigopArg(isExponent) {
    if (this.peek().t === '(') {
      this.next();
      return this.group(')');
    }
    return this.scriptArg(isExponent);
  }

  bigop(op) {
    let lower = [];
    let upper = [];
    if (this.peek().t === '_') {
      this.next();
      lower = this.bigopArg(false);
    }
    if (this.peek().t === '^') {
      this.next();
      upper = this.bigopArg(true);
    }
    return makeBigop(op, lower, upper);
  }

  sqrt(isWord) {
    let index = null;
    if (!isWord && this.peek().t === '[') {
      this.next();
      index = this.group(']');
    }
    let arg = [];
    const t = this.peek().t;
    if (t === '{') {
      this.next();
      arg = this.group('}');
    } else if (t === '(') {
      this.next();
      arg = this.group(')');
    } else if (isWord) {
      // "sqrt 2x": the argument runs while factors keep coming.
      if (this.peek().t === 'op' && this.peek().v === '-') arg.push(opAtom(this.next().v));
      if (!IMPLICIT_START.has(this.peek().t)) this.fail('Expected an argument after "sqrt"');
      while (IMPLICIT_START.has(this.peek().t)) {
        this.primary(arg);
        if (this.peek().t === '^') {
          this.next();
          arg.push(makeScript('sup', this.scriptArg(true)));
        }
      }
    } else {
      if (!SCRIPT_START.has(t)) this.fail('Expected an argument after "\\sqrt"');
      this.primary(arg);
      if (this.peek().t === '^') {
        this.next();
        arg.push(makeScript('sup', this.scriptArg(true)));
      }
    }
    return makeSqrt(arg, index);
  }

  // One syntactic unit (operand, operator, bracketed group, ...); pushes its item(s).
  primary(items) {
    const tok = this.next();
    switch (tok.t) {
      case 'num':
        for (const ch of tok.v) items.push(makeAtom(ch, ch, 'num'));
        return;
      case 'letter':
        items.push(makeAtom(tok.v, tok.v, 'var'));
        return;
      case 'extra':
        for (const ch of tok.v) items.push(makeAtom(ch, ch, 'var'));
        return;
      case 'name':
        items.push(
          tok.v in GREEK ? greekAtom(tok.v) : makeAtom(tok.v, `\\mathrm{${tok.v}}`, 'var'),
        );
        return;
      case 'fn':
        items.push(fnAtom(tok.v));
        return;
      case 'greek':
        items.push(greekAtom(tok.v));
        return;
      case 'const':
        items.push(constAtom(tok.v));
        return;
      case 'bigop':
        items.push(this.bigop(tok.v));
        return;
      case 'sqrt':
        items.push(this.sqrt(false));
        return;
      case 'sqrtw':
        items.push(this.sqrt(true));
        return;
      case 'frac': {
        this.expect('{');
        const num = this.group('}');
        this.expect('{');
        const den = this.group('}');
        items.push(makeFrac(num, den));
        return;
      }
      case '(':
      case '[':
      case '{':
        items.push(makeParen(tok.t, this.group(BLOCK_OPEN[tok.t])));
        return;
      case '|':
        items.push(makeParen('|', this.group('|')));
        return;
      case 'left': {
        const open = this.next().t;
        if (!(open in CLOSE_OF)) this.fail('Expected a bracket after \\left');
        const inner = this.seq('right');
        this.expect('right');
        const close = this.next().t;
        if (close !== CLOSE_OF[open]) this.fail('Mismatched \\left / \\right brackets');
        items.push(makeParen(open, inner));
        return;
      }
      case 'op':
        items.push(opAtom(tok.v));
        return;
      case ',':
      case ':':
      case '!':
        items.push(makeAtom(tok.t, tok.t, 'punct'));
        return;
      case 'eof':
        this.fail('Unexpected end of input');
        return;
      default:
        this.fail(`Unexpected "${tok.v ?? tok.t}"`);
    }
  }
}

// Multi-letter parameter names in "f(mass, k) = ..." are single variables for the parser, so
// they must not be split into function words here ("tangent" is not tan + gent).
function headerWords(src) {
  const plain = src.replace(/\\(left|right)(?![A-Za-z])/g, '');
  const m = /^\\?[A-Za-z][A-Za-z0-9]*(?:_\{?[A-Za-z0-9]+\}?)?\s*\(([^()=]*)\)\s*=(?!=)/.exec(plain);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z]{2,}$/.test(p) && !(p in GREEK) && !(p in CONSTANTS))
    .filter((p) => !FUNCTION_SET.has(p));
}

/**
 * Import LaTeX / plain-ASCII math into a tree.
 * @returns {{ ok: true, root: object } | { ok: false, error: string }}
 */
export function fromLatex(src) {
  if (typeof src !== 'string') return { ok: false, error: 'Expected a string' };
  try {
    const importer = new Importer(lex(src, headerWords(src)));
    const items = importer.seq(null);
    return { ok: true, root: makeBlock(items) };
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message };
    throw err;
  }
}
