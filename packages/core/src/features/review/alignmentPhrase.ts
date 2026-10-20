/**
 * How the alignment score reads on a card, or null when it should not show.
 *
 * "25% aligned" on a decided card read as a verdict on the agent in front of a
 * client (finance demo, 2026-10-20), and it was three decisions, all rejections
 * of superseded cards. A rate over a handful of decisions is noise, so it shows
 * only once there is a real history, and it says what it counts.
 */
export const MIN_ALIGNMENT_SAMPLE = 5;

export type Alignment = { agreementRate: number | null; n: number; window: string };

/**
 * The phrase for a card's alignment, or null below the minimum sample.
 * @param a - The server-computed alignment.
 */
export function alignmentPhrase(a: Alignment | null | undefined): { short: string; long: string } | null {
  if (!a || a.agreementRate === null || a.n < MIN_ALIGNMENT_SAMPLE) {
    return null;
  }
  const agreed = Math.round(a.agreementRate * a.n);
  const window = a.window === 'all' ? 'so far' : `in the last ${a.window}`;
  return {
    short: `You agreed ${agreed} of ${a.n}`,
    long: `You agreed with ${agreed} of this agent's last ${a.n} recommendations of this kind ${window}.`,
  };
}
