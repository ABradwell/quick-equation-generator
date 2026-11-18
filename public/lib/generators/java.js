import {
  PREC,
  collectNames,
  docComment,
  floatLiteral,
  hasNestedLoop,
  isNegativeNumber,
  literalBound,
  makeFresh,
  safeName,
  wrap,
} from './shared.js';

const RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null', 'var', 'yield', 'record', '_',
  // Names the generated code relies on (a local called `Math` would shadow the class).
  'Math', 'Double', 'java',
]); // prettier-ignore

const UNARY = {
  sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', ln: 'log', log10: 'log10',
  sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs', floor: 'floor', ceil: 'ceil', sign: 'signum',
}; // prettier-ignore

const ind = (n) => '    '.repeat(n);

/** @param {{name: string, params: string[], body: object}} def */
export function generate(def) {
  const taken = collectNames(def);
  const fresh = makeFresh(taken);
  const renamedIndices = new Set();
  const fname = safeName(def.name, RESERVED);
  const params = def.params.map((p) => safeName(p, RESERVED));

  // Every emit* returns { s: source, p: precedence }; `lvl` is the indent of the line it starts on.
  // `env` maps AST names to Java names for everything currently in scope.
  function emit(node, lvl, env) {
    switch (node.type) {
      case 'num': {
        const neg = isNegativeNumber(node);
        return {
          s: `${neg ? '-' : ''}${floatLiteral(node.value)}`,
          p: neg ? PREC.UNARY : PREC.ATOM,
        };
      }
      case 'const':
        if (node.name === 'tau') return { s: '2.0 * Math.PI', p: PREC.MUL };
        return { s: node.name === 'pi' ? 'Math.PI' : 'Math.E', p: PREC.ATOM };
      case 'var':
        return { s: env.get(node.name) ?? safeName(node.name, RESERVED), p: PREC.ATOM };
      case 'neg':
        return { s: `-${wrap(emit(node.arg, lvl, env), PREC.UNARY + 1)}`, p: PREC.UNARY };
      case 'bin':
        return emitBin(node, lvl, env);
      case 'call':
        return emitCall(node, lvl, env);
      case 'sum':
      case 'prod':
        return emitLoop(node, lvl, env);
      case 'piecewise':
        return emitPiecewise(node, lvl, env);
      case 'cmp':
        return {
          s: `${wrap(emit(node.left, lvl, env), PREC.ADD)} ${node.op} ${wrap(emit(node.right, lvl, env), PREC.ADD)}`,
          p: PREC.CMP,
        };
      case 'and':
        return {
          s: node.args.map((a) => wrap(emit(a, lvl, env), PREC.CMP)).join(' && '),
          p: PREC.AND,
        };
      default:
        throw new Error(`Unknown node ${node.type}`);
    }
  }

  function emitBin(node, lvl, env) {
    if (node.op === '^') {
      return {
        s: `Math.pow(${emit(node.left, lvl, env).s}, ${emit(node.right, lvl, env).s})`,
        p: PREC.ATOM,
      };
    }
    const p = node.op === '+' || node.op === '-' ? PREC.ADD : PREC.MUL;
    const l = wrap(emit(node.left, lvl, env), p);
    const r = wrap(emit(node.right, lvl, env), p + 1);
    return { s: `${l} ${node.op} ${r}`, p };
  }

  function emitCall(node, lvl, env) {
    const atom = (s) => ({ s, p: PREC.ATOM });
    const args = node.args.map((a) => emit(a, lvl, env));
    if (UNARY[node.fn]) return atom(`Math.${UNARY[node.fn]}(${args[0].s})`);
    switch (node.fn) {
      case 'atan2':
        return atom(`Math.atan2(${args[0].s}, ${args[1].s})`);
      case 'min':
      case 'max':
        return atom(args.map((a) => a.s).reduce((acc, a) => `Math.${node.fn}(${acc}, ${a})`));
      // Java has no inverse hyperbolic functions; the argument is repeated, which is fine for a pure expression.
      case 'asinh': {
        const a = wrap(args[0], PREC.MUL);
        return atom(`Math.log(${a} + Math.sqrt(${a} * ${a} + 1.0))`);
      }
      case 'acosh': {
        const a = wrap(args[0], PREC.MUL);
        return atom(`Math.log(${a} + Math.sqrt(${a} * ${a} - 1.0))`);
      }
      case 'atanh': {
        const a = wrap(args[0], PREC.ADD + 1);
        return atom(`0.5 * Math.log((1.0 + ${a}) / (1.0 - ${a}))`);
      }
      default:
        throw new Error(`Unknown function ${node.fn}`);
    }
  }

  function emitLoop(node, lvl, env) {
    const isSum = node.type === 'sum';
    const acc = fresh(isSum ? 'sum' : 'prod');
    const hi = fresh('hi');
    // The index must not redeclare anything in scope (lambdas cannot shadow locals).
    const inScope = new Set(env.values());
    let k = safeName(node.index, RESERVED);
    while (inScope.has(k) || renamedIndices.has(k)) k += '_';
    if (k !== node.index) renamedIndices.add(k);
    const inner = new Map(env).set(node.index, k);

    // A nested lambda can only capture effectively-final variables, so a loop
    // counter that is used inside one is copied into a per-iteration local.
    const copy = hasNestedLoop(node);
    const counter = copy ? fresh('i') : k;
    const bound = (b) =>
      literalBound(b) ?? `Math.floor(${wrap(emit(b, lvl + 1, env), PREC.ADD)} + 0.5)`;
    const body = emit(node.body, lvl + 2, inner).s;
    const s = [
      '((java.util.function.DoubleSupplier) () -> {',
      `${ind(lvl + 1)}double ${acc} = ${isSum ? '0.0' : '1.0'};`,
      `${ind(lvl + 1)}double ${hi} = ${bound(node.to)};`,
      `${ind(lvl + 1)}for (double ${counter} = ${bound(node.from)}; ${counter} <= ${hi}; ${counter}++) {`,
      ...(copy ? [`${ind(lvl + 2)}double ${k} = ${counter};`] : []),
      `${ind(lvl + 2)}${acc} ${isSum ? '+=' : '*='} ${body};`,
      `${ind(lvl + 1)}}`,
      `${ind(lvl + 1)}return ${acc};`,
      `${ind(lvl)}}).getAsDouble()`,
    ].join('\n');
    return { s, p: PREC.ATOM };
  }

  function emitPiecewise(node, lvl, env) {
    const other = node.otherwise
      ? emit(node.otherwise, lvl + 1, env)
      : { s: 'Double.NaN', p: PREC.ATOM };
    const arms = node.cases.map(
      (c) => `${emit(c.cond, lvl, env).s} ? ${wrap(emit(c.value, lvl + 1, env), PREC.AND)}`,
    );
    const tail = wrap(other, PREC.TERNARY);
    if (arms.length === 1) return { s: `${arms[0]} : ${tail}`, p: PREC.TERNARY };
    const s = [
      ...arms.map((a, i) => (i ? `${ind(lvl + 2)}: ${a}` : a)),
      `${ind(lvl + 2)}: ${tail}`,
    ].join('\n');
    return { s, p: PREC.TERNARY };
  }

  const env = new Map(def.params.map((p, i) => [p, params[i]]));
  const body = emit(def.body, 1, env).s;
  return [
    '// Paste this method into a class.\n',
    `/** ${docComment(fname, params)} */\n`,
    `public static double ${fname}(${params.map((p) => `double ${p}`).join(', ')}) {\n`,
    `${ind(1)}return ${body};\n`,
    '}',
  ].join('');
}
