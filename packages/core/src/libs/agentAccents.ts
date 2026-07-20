/**
 * Map an agent's authored accent name (workspace YAML `accent:`) to a small
 * palette: saturated stripe/ink for accents, a soft tint for icon tiles.
 * Tints are light-tuned, so they only ever back small elements.
 *
 * One canonical copy — the agents roster, agent profile, and teams org
 * chart all color from here so a team inherits its lead's hue exactly.
 */

export type AgentAccent = { stripe: string; tint: string; ink: string };

/**
 * Resolve an accent name to its palette. Unknown/absent names fall back
 * to the brand amber.
 * @param name - The authored `accent` field (amber | teal | violet | indigo | rose).
 */
export function agentAccent(name: string | null | undefined): AgentAccent {
  switch (name) {
    case 'teal':
      return { stripe: 'var(--brand-teal)', tint: 'var(--brand-teal-tint)', ink: 'var(--brand-teal-deep)' };
    case 'violet':
      return { stripe: '#7C5CFC', tint: '#F1EEFE', ink: '#5B3FD6' };
    case 'indigo':
      return { stripe: '#5B6EF5', tint: '#EEF1FE', ink: '#3F4FD6' };
    case 'rose':
      return { stripe: '#F0567A', tint: '#FDEEF2', ink: '#D63A60' };
    default:
      return { stripe: 'var(--brand-amber)', tint: 'var(--brand-amber-tint)', ink: 'var(--brand-amber-deep)' };
  }
}
