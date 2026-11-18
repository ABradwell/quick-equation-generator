// TypeScript generator: AST (docs/AST.md) -> a standalone exported function.
// Results follow public/lib/evaluate.js; NaN and Infinity behave as in the reference.

// Precedence, loosest to tightest, following JavaScript's grammar.
const P = { COND: 0, OR: 1, AND: 2, CMP: 3, ADD: 4, MUL: 5, UNARY: 6, POW: 7, ATOM: 8 };

// Reserved words, plus globals the generated code uses (a parameter named Math would shadow it).
const RESERVED = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'undefined',
  'NaN',
  'Infinity',
  'Math',
]);

const CONSTS = { pi: 'Math.PI', tau: '(2 * Math.PI)', e: 'Math.E' };

// Functions that are the same name under Math, except ln -> Math.log.
const MATH_FUNCS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'log10',
  'sqrt',
  'cbrt',
  'abs',
  'floor',
  'ceil',
  'sign',
  'min',
  'max',
]);

const JS_CMP = { '==': '===' };

function ident(name) {
  return RESERVED.has(name) ? `${name}_` : name;
}

/** Source text of a node, plus its precedence. */
function expr(node) {
  switch (node.type) {
    case 'num':
      return [String(node.value), P.ATOM];
    case 'const':
      return [CONSTS[node.name], P.ATOM];
    case 'var':
      return [ident(node.name), P.ATOM];
    case 'neg':
      // Always parenthesise the operand: -x ** 2 is a syntax error, and -(-x) avoids "--".
      return [`-${wrap(node.arg, P.ATOM)}`, P.UNARY];
    case 'bin':
      return binary(node);
    case 'call':
      return [call(node), P.ATOM];
    case 'sum':
    case 'prod':
      return [loop(node), P.ATOM];
    case 'piecewise':
      return [piecewise(node), P.ATOM];
    case 'cmp':
      return [
        `${wrap(node.left, P.ADD)} ${JS_CMP[node.op] ?? node.op} ${wrap(node.right, P.ADD)}`,
        P.CMP,
      ];
    case 'and':
      return [node.args.map(text).join(' && '), P.AND];
    default:
      throw new Error(`typescript generator: unsupported node "${node.type}"`);
  }
}

const text = (node) => expr(node)[0];

/** Source of a node, parenthesised when its precedence is below `min`. */
function wrap(node, min) {
  const [code, prec] = expr(node);
  return prec >= min ? code : `(${code})`;
}

function binary({ op, left, right }) {
  switch (op) {
    case '+':
    case '-':
      return [`${wrap(left, P.ADD)} ${op} ${wrap(right, P.MUL)}`, P.ADD];
    case '*':
    case '/':
      return [`${wrap(left, P.MUL)} ${op} ${wrap(right, P.UNARY)}`, P.MUL];
    case '^':
      // ** cannot take a unary left operand, so (-x) ** 2 keeps its parentheses.
      return [`${wrap(left, P.ATOM)} ** ${wrap(right, P.UNARY)}`, P.POW];
    default:
      throw new Error(`typescript generator: unknown operator "${op}"`);
  }
}

function call({ fn, args }) {
  if (!MATH_FUNCS.has(fn) && fn !== 'ln') {
    throw new Error(`typescript generator: unknown function "${fn}"`);
  }
  const parts = args.map(text);
  const name = fn === 'ln' ? 'log' : fn;
  return `Math.${name}(${parts.join(', ')})`;
}

/** Integer loop bound Math.floor(x + 0.5), with numeric literals folded. */
function bound(node) {
  if (node.type === 'num') return String(Math.floor(node.value + 0.5));
  return `Math.floor(${text(node)} + 0.5)`;
}

function loop(node) {
  // Scratch names start with "_", which the parser never produces, so they cannot clash with
  // parameters or with an index in an enclosing sum.
  const index = ident(node.index);
  const isSum = node.type === 'sum';
  const init = isSum ? 0 : 1;
  const op = isSum ? '+=' : '*=';
  return (
    `(() => { const _lo = ${bound(node.from)}, _hi = ${bound(node.to)}; let _acc = ${init}; ` +
    `for (let ${index} = _lo; ${index} <= _hi; ${index}++) _acc ${op} ${text(node.body)}; ` +
    'return _acc; })()'
  );
}

function piecewise({ cases, otherwise }) {
  let out = otherwise ? text(otherwise) : 'NaN';
  for (let i = cases.length - 1; i >= 0; i--) {
    out = `${text(cases[i].cond)} ? ${text(cases[i].value)} : ${out}`;
  }
  return `(${out})`;
}

/** @param {{name: string, params: string[], body: object}} def */
export function generate(def) {
  const params = def.params.map((p) => `${ident(p)}: number`).join(', ');
  return [
    '/**',
    ` * Evaluate ${def.name}(${def.params.join(', ')}).`,
    ' */',
    `export function ${ident(def.name)}(${params}): number {`,
    `    return ${text(def.body)};`,
    '}',
    '',
  ].join('\n');
}
