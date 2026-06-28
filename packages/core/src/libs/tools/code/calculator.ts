/**
 * Safe arithmetic evaluator — no `eval` of arbitrary code. Input is
 * gated to numbers, operators, parens, and an allowlist of math
 * identifiers; any other identifier (e.g. `constructor`, `process`)
 * rejects the expression. Functions/constants are bound from a fixed
 * scope, so no access to globals is possible.
 */

const SCOPE: Record<string, number | ((...n: number[]) => number)> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  pow: Math.pow,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sign: Math.sign,
  trunc: Math.trunc,
  hypot: Math.hypot,
  pi: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
};

export function calculate(expression: string): number {
  const expr = expression.trim();
  if (!expr) {
    throw new Error('empty expression');
  }
  if (expr.length > 500) {
    throw new Error('expression too long');
  }
  if (!/^[\w\s+\-*/%.,()^]+$/.test(expr)) {
    throw new Error('expression contains unsupported characters (only numbers, + - * / % ^ ( ) , and math functions are allowed)');
  }
  const idents = expr.match(/[a-z_]+/gi) ?? [];
  for (const id of idents) {
    // hasOwn (not `in`) so inherited names like `constructor`/`toString`
    // can never slip past the allowlist.
    if (!Object.hasOwn(SCOPE, id.toLowerCase())) {
      throw new Error(`unknown identifier "${id}" — allowed: ${Object.keys(SCOPE).join(', ')}`);
    }
  }
  const js = expr.replace(/\^/g, '**');
  const names = Object.keys(SCOPE);
  // Safe: only allowlisted identifiers can appear (validated above), and
  // the function body is built from that sanitized expression with no
  // other names in scope.
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, `'use strict'; return (${js});`);
  const result = fn(...names.map(n => SCOPE[n]));
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new TypeError('result is not a finite number');
  }
  return result;
}
