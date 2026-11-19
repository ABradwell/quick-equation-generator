# Equation Converter

Type math the way you would in Desmos and get a standalone function you can paste into
**Python, TypeScript, Go, Rust or Java**. The preview typesets as you type, one-variable
functions are graphed, and your previous equations are kept in the browser.

```
f(x) = x^2 + 2x + 1          →   def f(x: float) -> float: ...
g(t) = e^{-t^2/2}/\sqrt{2\pi} →   func g(t float64) float64 { ... }
```

## Getting started

Requires Node 22.18 or newer, which runs the TypeScript server and tests directly.

```sh
pnpm install   # dev tools only (TypeScript, ESLint, Prettier) – the app has no runtime dependencies
pnpm start     # builds, then serves http://localhost:5173  (PORT=8080 pnpm start to change)
```

| Script                              | What it does                                            |
| ----------------------------------- | ------------------------------------------------------- |
| `pnpm build`                        | Compile `src/` to JavaScript in `public/`               |
| `pnpm start`                        | Build, then start the static server                     |
| `pnpm dev`                          | Rebuild on change and restart the server on change      |
| `pnpm test`                         | Parser tests + compile-and-run tests for every language |
| `pnpm typecheck`                    | `tsc` over source, tests and server                     |
| `pnpm lint`                         | ESLint                                                  |
| `pnpm format` / `pnpm format:check` | Prettier                                                |

The generator tests compile the output with the real toolchains (`python3`, `tsc`, `go`,
`rustc`, `javac`) and compare every result against the JavaScript reference evaluator.
A language whose toolchain is not installed is skipped.

## What you can type

| Input                                                    | Meaning                                               |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `f(x, y) = ...`                                          | Named function with explicit parameter order          |
| `y = ...`                                                | Function named `y`; parameters are the variables used |
| `x^2 + y^2 = 1`                                          | Implicit equation, returns left − right               |
| `2x`, `x(x+1)`, `2sin x`                                 | Implicit multiplication                               |
| `x^2`, `x**2`, `e^{-x}`                                  | Powers                                                |
| `sqrt(x)`, `\sqrt{x}`, `\sqrt[3]{x}`, `√x`               | Roots                                                 |
| `\frac{a}{b}`, `a/b`                                     | Division                                              |
| `\|x\|`, `abs(x)`                                        | Absolute value                                        |
| `sin cos tan sec csc cot`, `sin^{-1}`, `arcsin`, `sinh`… | Trig and hyperbolic                                   |
| `ln`, `log`, `log_2`, `exp`                              | Logs and exponential                                  |
| `floor ceil round sign mod min max atan2`                | Other functions                                       |
| `pi`, `π`, `tau`, `e`                                    | Constants                                             |
| `\alpha`, `theta`, `θ`, `x_1`, `v_{max}`                 | Greek letters and subscripts                          |
| `\sum_{n=1}^{N} ...`, `\prod_{k=1}^{n} ...`              | Sums and products                                     |
| `{x<0: -x, 0<x<1: x^2, 1}`                               | Piecewise (Desmos syntax)                             |
| `ke(mass, v) = mass v^2/2`                               | Multi-letter names, if declared as parameters         |

## Visual editor

The equation box is a visual editor, like Desmos: typing `/` stacks a fraction, `^` opens a
power, `sqrt` draws a radical. Its output is a LaTeX string that goes through the same parser,
preview, code generators, graph and history as before. A palette above the box has buttons for
fractions, powers, roots, brackets, sums, piecewise functions, common functions, symbols and a
Greek-letter popover; every button's tooltip names the keyboard shortcut. The **Visual | Text**
switch next to the label changes to the plain text box (with the error underline); your choice
is remembered. The palette works in both modes (in Text mode it inserts LaTeX at the caret).

| Type                                | Result                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                                 | Fraction (the operand before the caret, or the selection, becomes the numerator)                |
| `^`, `_`                            | Superscript, subscript (arrow right leaves it)                                                  |
| `sqrt`, `nthroot`                   | Square root, nth root (index first)                                                             |
| `sum`, `prod`                       | Σ / Π with lower and upper limits                                                               |
| `(`, `[`, `{`, `\|`                 | Brackets that grow with their content; the closing key steps out                                |
| `theta`, `pi`, `alpha` ...          | Greek letters and constants; `sin`, `cos`, `ln` ... become function names                       |
| Arrows, Home, End                   | Move through the structure; Up/Down switch between numerator and denominator, limits, exponents |
| Shift + arrows, Ctrl/Cmd+A          | Select; typing or `/` `(` `^` wraps the selection                                               |
| Backspace / Delete                  | Delete, or step into / unwrap a structure                                                       |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Y) | Undo, redo                                                                                      |
| Ctrl/Cmd+C, X, V                    | Copy (as LaTeX), cut, paste LaTeX or plain text                                                 |

Click anywhere in the equation to place the caret and drag to select. In Visual mode the large
typeset preview is replaced by a one-line "Becomes f(x)" summary, since the editor is already
typeset. While slots are still empty you see "Keep typing..." instead of an error.

## Deployment (Vercel)

The app is static files only. Vercel installs the dev dependencies, runs `npm run build` to
compile `src/` into `public/`, and serves `public/`. `vercel.json` sets this up and blocks common bot-probe paths (`.env`, `wp-admin`, `*.php`…).

1. Import the repository at [vercel.com/new](https://vercel.com/new). Leave the framework
   preset as **Other**; the settings in `vercel.json` take over.
2. Deploy. Every push to `main` deploys to production and every pull request gets a preview.
3. In **Project → Settings → Domains**, add the subdomain (for example
   `equations.aidenbradwell.com`). If the domain's DNS is managed by Vercel this is
   automatic; otherwise add a `CNAME` record pointing to `cname.vercel-dns.com`.

`server.ts` is only for local development and is not deployed.

## Project layout

```
server.ts                    tiny static server (node:http only)
public/                      index.html, style.css; build output (app.js, lib/) is git-ignored
src/
  app.ts                     page wiring
  lib/ast.ts                 AST types
  lib/parser.ts              math notation → AST
  lib/evaluate.ts            reference evaluator (graph + tests)
  lib/render.ts              AST → typeset HTML preview
  lib/editor/                visual editor: model, latex, tree, view, palette, util
  lib/generators/*.ts        AST → Python / TypeScript / Go / Rust / Java
docs/AST.md                  AST format shared by all of the above
docs/EDITOR.md               visual editor design
test/                        node:test suites (run directly by Node's type stripping)
```

Adding a language means writing one `generate(def)` function (see `docs/AST.md`) and
registering it in `src/lib/generators/index.ts`.
