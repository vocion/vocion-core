/**
 * A 0–1 pass rate as the percentage people read, e.g. `79.5%`.
 *
 * Kept to two decimal places with trailing zeros dropped, and cut off rather
 * than rounded: whole-percent rounding showed a 159/200 run (79.5%) as "80%"
 * while the page counted it under an 80% bar, and rounding up at any precision
 * can do the same to a run just under the line. Cutting off never moves a
 * number across the threshold it is compared with.
 *
 * The small nudge before cutting off absorbs 64-bit arithmetic noise —
 * `0.29 * 10000` is `2899.9999999999995`, which is meant as 29%, not 28.99%.
 * It is a millionth of a hundredth of a percent, far below any gap a real pass
 * rate has from the bar. Every rate this formats is stored as a 64-bit number;
 * `eval_score.value` was a 32-bit `real` until migration 0143, whose six-digit
 * noise no nudge this small could absorb.
 * @param rate - A pass rate from 0 to 1.
 */
export function formatPassRate(rate: number): string {
  const hundredthsOfAPercent = Math.floor(rate * 10_000 + 1e-6);
  return `${hundredthsOfAPercent / 100}%`;
}
