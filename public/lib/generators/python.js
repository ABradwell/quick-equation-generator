// Python generator: AST (docs/AST.md) -> a standalone `def` returning one expression.
// Results follow public/lib/evaluate.js; Python raises where the reference gives inf/NaN.

// Precedence, loosest to tightest, following Python's grammar.
const P = { COND: 0, AND: 1, CMP: 2, ADD: 3, MUL: 4, UNARY: 5, POW: 6, ATOM: 7 };

const KEYWORDS = [
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
];
// Builtins and the module the generated code uses; a parameter with one of these names would shadow it.
const SHADOWED = ['math', 'float', 'map', 'range', 'abs', 'min', 'max', 'sum'];
const RESERVED = new Set([...KEYWORDS, ...SHADOWED]);

const CONSTS = { pi: 'math.pi', tau: 'math.tau', e: 'math.e' };

// Functions that map straight onto math.<name>, except ln -> math.log.
const MATH_FUNCS = {
  sin: 'math.sin',
  cos: 'math.cos',
  tan: 'math.tan',
  asin: 'math.asin',
  acos: 'math.acos',
  atan: 'math.atan',
  atan2: 'math.atan2',
  sinh: 'math.sinh',
  cosh: 'math.cosh',
  tanh: 'math.tanh',
  asinh: 'math.asinh',
  acosh: 'math.acosh',
  atanh: 'math.atanh',
  exp: 'math.exp',
  ln: 'math.log',
  log10: 'math.log10',
  sqrt: 'math.sqrt',
};

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
      // -x ** 2 is -(x ** 2) in Python, which is what the AST means.
      return [`-${wrap(node.arg, P.POW)}`, P.UNARY];
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
      return [`${wrap(node.left, P.ADD)} ${node.op} ${wrap(node.right, P.ADD)}`, P.CMP];
    case 'and':
      return [node.args.map(text).join(' and '), P.AND];
    default:
      throw new Error(`python generator: unsupported node "${node.type}"`);
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
      // Left-associative: an equal-precedence right operand needs parentheses.
      return [`${wrap(left, P.ADD)} ${op} ${wrap(right, P.MUL)}`, P.ADD];
    case '*':
    case '/':
      return [`${wrap(left, P.MUL)} ${op} ${wrap(right, P.UNARY)}`, P.MUL];
    case '^': {
      // `**` gives a complex number for (-4) ** 0.5, so only use it when that cannot
      // happen: an integer exponent, or a base that is a non-negative literal/constant.
      const intExponent = right.type === 'num' && Number.isInteger(right.value);
      const safeBase = (left.type === 'num' && left.value >= 0) || left.type === 'const';
      if (!intExponent && !safeBase) {
        return [`math.pow(${text(left)}, ${text(right)})`, P.ATOM];
      }
      // Right-associative, and the right operand may be unary (2 ** -x).
      return [`${wrap(left, P.ATOM)} ** ${wrap(right, P.UNARY)}`, P.POW];
    }
    default:
      throw new Error(`python generator: unknown operator "${op}"`);
  }
}

function call({ fn, args }) {
  const parts = args.map(text);
  const [a] = parts;
  switch (fn) {
    case 'cbrt':
      // math.cbrt needs Python 3.11, so use a form that works everywhere and keeps the sign.
      return `math.copysign(abs(${a}) ** (1 / 3), ${a})`;
    case 'floor':
      // math.floor returns an int; keep the float semantics of the reference.
      return `float(math.floor(${a}))`;
    case 'ceil':
      return `float(math.ceil(${a}))`;
    case 'sign':
      return `(math.nan if ${a} != ${a} else math.copysign(1.0, ${a}) if ${a} else 0.0)`;
    case 'abs':
    case 'min':
    case 'max':
      return `${fn}(${parts.join(', ')})`;
    default:
      if (!(fn in MATH_FUNCS)) throw new Error(`python generator: unknown function "${fn}"`);
      return `${MATH_FUNCS[fn]}(${parts.join(', ')})`;
  }
}

/** Integer loop bound floor(x + 0.5) plus `extra`, with numeric literals folded. */
function bound(node, extra) {
  if (node.type === 'num') return String(Math.floor(node.value + 0.5) + extra);
  const base = `math.floor(${text(node)} + 0.5)`;
  return extra ? `${base} + ${extra}` : base;
}

function loop(node) {
  // map(float, ...) makes the index a float inside the body, as in the reference.
  const range = `map(float, range(${bound(node.from, 0)}, ${bound(node.to, 1)}))`;
  const body = text(node.body);
  const index = ident(node.index);
  if (node.type === 'sum') return `sum(${body} for ${index} in ${range})`;
  return `math.prod(${body} for ${index} in ${range})`;
}

function piecewise({ cases, otherwise }) {
  let out = otherwise ? text(otherwise) : 'math.nan';
  for (let i = cases.length - 1; i >= 0; i--) {
    out = `${text(cases[i].value)} if ${text(cases[i].cond)} else ${out}`;
  }
  return `(${out})`;
}

/** @param {{name: string, params: string[], body: object}} def */
export function generate(def) {
  const params = def.params.map((p) => `${ident(p)}: float`).join(', ');
  const code = text(def.body);
  const source = [
    `def ${ident(def.name)}(${params}) -> float:`,
    `    """Evaluate ${def.name}(${def.params.join(', ')})."""`,
    `    return ${code}`,
    '',
  ].join('\n');
  return code.includes('math.') ? `import math\n\n\n${source}` : source;
}
