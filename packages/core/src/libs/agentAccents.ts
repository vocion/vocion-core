/**
 * Map an agent's authored accent name (workspace YAML `accent:`) to a small
 * palette: saturated stripe/ink for accents, a soft tint for icon tiles, and
 * the `dot` an `AgentDot` is filled with.
 *
 * One canonical copy — the agents roster, agent profile, teams org chart,
 * chat and Needs you all colour from here, so a team inherits its lead's hue
 * exactly and an agent is the same colour wherever it appears.
 *
 * `dot` is chosen so a white initial on it clears WCAG AA (≥ 4.5:1) — every
 * value below is checked in `agentAccents.test.ts`. Tints are light-tuned,
 * so they only ever back small elements.
 */

export type AgentAccent = { stripe: string; tint: string; ink: string; dot: string };

/**
 * Every accent name a workspace authors today. An unknown or absent name falls
 * back to amber, the brand accent.
 */
const PALETTE: Record<string, AgentAccent> = {
  amber: { stripe: 'var(--brand-amber)', tint: 'var(--brand-amber-tint)', ink: 'var(--brand-amber-deep)', dot: '#a35700' },
  teal: { stripe: 'var(--brand-teal)', tint: 'var(--brand-teal-tint)', ink: 'var(--brand-teal-deep)', dot: '#0b7c79' },
  violet: { stripe: '#7C5CFC', tint: '#F1EEFE', ink: '#5B3FD6', dot: '#7c3cff' },
  indigo: { stripe: '#5B6EF5', tint: '#EEF1FE', ink: '#3F4FD6', dot: '#4d63ff' },
  rose: { stripe: '#F0567A', tint: '#FDEEF2', ink: '#D63A60', dot: '#c2335f' },
  blue: { stripe: '#168BFF', tint: '#E9F3FF', ink: '#0E6FD1', dot: '#0b6fd6' },
  sky: { stripe: '#0EA5E9', tint: '#E0F2FE', ink: '#0369A1', dot: '#0369a1' },
  cyan: { stripe: '#06B6D4', tint: '#E0F7FA', ink: '#0A7490', dot: '#0a7490' },
  emerald: { stripe: '#1F9D57', tint: '#DCF4E8', ink: '#187A45', dot: '#187a45' },
  lime: { stripe: '#65A30D', tint: '#ECFCCB', ink: '#4D7C0F', dot: '#4d7c0f' },
  orange: { stripe: '#F0782A', tint: '#FFE8D9', ink: '#B4501A', dot: '#b4501a' },
  yellow: { stripe: '#EAB308', tint: '#FFF1C9', ink: '#856000', dot: '#856000' },
  red: { stripe: '#E5484D', tint: '#FFEBEE', ink: '#C62828', dot: '#c62828' },
  fuchsia: { stripe: '#D946EF', tint: '#FAE8FF', ink: '#A21CAF', dot: '#a21caf' },
  purple: { stripe: '#9333EA', tint: '#F3E8FF', ink: '#7E22CE', dot: '#7e22ce' },
  slate: { stripe: '#64748B', tint: '#F1F5F9', ink: '#475569', dot: '#475569' },
  stone: { stripe: '#78716C', tint: '#F5F5F4', ink: '#57534E', dot: '#57534e' },
};

/** The accent names the palette knows, for a lint or a story. */
export const AGENT_ACCENT_NAMES = Object.keys(PALETTE);

/**
 * Resolve an accent name to its palette. Unknown/absent names fall back
 * to the brand amber.
 * @param name - The authored `accent` field (amber | teal | violet | indigo | rose | …).
 */
export function agentAccent(name: string | null | undefined): AgentAccent {
  return (name ? PALETTE[name.toLowerCase()] : undefined) ?? PALETTE.amber!;
}
