// Scientific notation in the AST: a literal mantissa times 10 raised to a literal integer.
// Shared by the evaluator and the code generators so both read the pattern the same way.
import type { Node } from './ast.ts';

/** A recognised `m * 10 ^ n`, possibly as the last factor of a longer product. */
export interface Scientific {
  /** Factors to the left of the mantissa (`2 * x` in `2 * x * 6.674 * 10^-11`), or null. */
  rest: Node | null;
  /** The literal `m e n`, signed. */
  value: number;
}

/**
 * Recognise `m * 10 ^ n` where m is a numeric literal (optionally negated) and n a literal
 * integer (optionally negated). The match may be the tail of a left-associative product, so
 * `a * b * m * 10 ^ n` yields `rest = a * b` and `value = m e n`.
 *
 * The value is built by decimal exponent (`6.674e-11`), not by multiplying, so it is the double
 * nearest the written number. `6.674 * 10 ** -11` can land one ulp away from it. The evaluator
 * and every generator use this same rule, so they agree on the result.
 */
export function scientific(node: Node): Scientific | null {
  if (node.type !== 'bin' || node.op !== '*') return null;
  const { left, right } = node;
  if (right.type !== 'bin' || right.op !== '^') return null;
  if (right.left.type !== 'num' || right.left.value !== 10) return null;
  let exp = right.right;
  let expSign = 1;
  if (exp.type === 'neg') {
    expSign = -1;
    exp = exp.arg;
  }
  if (exp.type !== 'num' || !Number.isInteger(exp.value) || Math.abs(exp.value) > 400) return null;

  // The mantissa is the whole left operand, or the last factor of a product on the left.
  let rest: Node | null = null;
  let mant: Node = left;
  if (left.type === 'bin' && left.op === '*') {
    rest = left.left;
    mant = left.right;
  }
  let sign = 1;
  if (mant.type === 'neg') {
    sign = -1;
    mant = mant.arg;
  }
  if (mant.type !== 'num' || !Number.isFinite(mant.value) || mant.value === 0) return null;
  if (mant.value < 0) sign = -sign;

  const [digits, e10] = Math.abs(mant.value).toExponential().split('e');
  const value = Number(`${digits}e${Number(e10) + expSign * exp.value}`);
  if (!Number.isFinite(value) || value === 0) return null;
  return { rest, value: sign * value };
}
