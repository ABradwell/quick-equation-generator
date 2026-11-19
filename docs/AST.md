# AST reference

`parseEquation(src)` in `src/lib/parser.ts` returns a `Definition` (types in `src/lib/ast.ts`):

```js
{
  name: 'f',          // function name; may contain "_" (e.g. "f_1") or be a Greek name ("theta")
  params: ['x', 'y'], // parameter names, in order; same naming rules as variables
  body: Node,         // the expression to return
  kind: 'function' | 'assignment' | 'implicit' | 'expression',
  warnings: string[],
}
```

All values are 64-bit floats. Every function takes only `double`/`f64`/`float`/`number`
parameters and returns one.

## Nodes

| Node       | Shape                                                        | Meaning                                                                                               |
| ---------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| number     | `{ type: 'num', value }`                                     | numeric literal (`value` is a JS number, e.g. `2`, `0.5`)                                             |
| constant   | `{ type: 'const', name }`                                    | `name` is `'pi'`, `'tau'` (2π) or `'e'`                                                               |
| variable   | `{ type: 'var', name }`                                      | a parameter or a sum/prod index. Names: letters, digits, `_` (e.g. `x`, `x_1`, `theta`, `A`, `v_max`) |
| negation   | `{ type: 'neg', arg }`                                       | `-arg`                                                                                                |
| binary     | `{ type: 'bin', op, left, right }`                           | `op` is `'+' '-' '*' '/' '^'` (`^` = power, float exponent)                                           |
| call       | `{ type: 'call', fn, args }`                                 | see function list below                                                                               |
| sum        | `{ type: 'sum', index, from, to, body }`                     | Σ over integers `k` from `lo` to `hi` inclusive of `body` with `index = k`                            |
| product    | `{ type: 'prod', index, from, to, body }`                    | Π, same rules; empty product is 1                                                                     |
| piecewise  | `{ type: 'piecewise', cases: [{ cond, value }], otherwise }` | first case whose `cond` is true wins; if none, `otherwise`, or `NaN` when `otherwise` is `null`       |
| comparison | `{ type: 'cmp', op, left, right }`                           | only inside `cond`; `op` is `'<' '>' '<=' '>=' '=='`                                                  |
| and        | `{ type: 'and', args }`                                      | only inside `cond`; all args (cmp nodes) must hold (from chains like `0<x<1`)                         |

### Sum / product bounds

`lo = floor(from + 0.5)`, `hi = floor(to + 0.5)` (both rounded to integers). If `hi < lo` the
sum is 0 and the product is 1. Inside `body` the index is used as a float with value `k`.
Bounds may depend on parameters (`\sum_{n=1}^{N} ...`). Sums can be nested.

### Functions (`call.fn`)

Exactly one argument unless noted:

`sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh exp ln log10 sqrt cbrt abs floor ceil sign`

- `ln` = natural log, `log10` = base-10 log.
- `sign` returns -1, 0 or 1 (NaN for NaN).
- `atan2(y, x)` — two arguments.
- `min(a, b, ...)`, `max(a, b, ...)` — two or more arguments.

`sec/csc/cot`, `log_b`, `round` and `mod` are rewritten by the parser into the nodes
above, so generators never see them.

### Naming

Variable and function names are already valid identifiers in all five target
languages _except_ for reserved words (e.g. `lambda` in Python, `fn` in Rust, `func` in Go).
Generators must rename clashes by appending `_`.

### Reference semantics

`src/lib/evaluate.ts` is the reference implementation. Generated code must give the
same results (within float tolerance).
