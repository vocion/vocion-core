/**
 * Per-agent accent palette helper (v0.3 — UI port from rev-ai).
 *
 * Each agent has a single `accent` field on its row (`agent.accent`)
 * carrying a CSS color name (`amber`, `teal`, `purple`, …). Rev-ai's
 * sidebar + chat color avatars, tool breadcrumbs, and active-state
 * tints via per-agent `.agent-<color>` classes. We translate the same
 * pattern into a Tailwind-friendly object the chat components can
 * spread onto child elements.
 *
 * Today only `amber` (the primary brand color) and `teal` (secondary,
 * for the second agent slot) are defined. Add new entries below as we
 * add more agents — keep the palette small on purpose.
 */

export type AgentAccentName = 'amber' | 'teal';

export type AgentAccent = {
  /** Solid accent (button bg, active text, focus ring). */
  text: string;
  bg: string;
  border: string;
  ring: string;
  /** Tinted variant for active-row backgrounds + pill bg. */
  tintBg: string;
  tintBorder: string;
  /** Deeper shade for hover. */
  deepBg: string;
  /**
   * A short Tailwind utility class string that components
   *  can spread onto the root element for cascade convenience.
   */
  className: string;
};

const PALETTE: Record<AgentAccentName, AgentAccent> = {
  amber: {
    text: 'text-brand-amber',
    bg: 'bg-brand-amber',
    border: 'border-brand-amber',
    ring: 'ring-brand-amber/30',
    tintBg: 'bg-brand-amber-tint',
    tintBorder: 'border-brand-amber/40',
    deepBg: 'hover:bg-brand-amber-deep',
    className: 'agent-amber',
  },
  teal: {
    text: 'text-brand-teal',
    bg: 'bg-brand-teal',
    border: 'border-brand-teal',
    ring: 'ring-brand-teal/30',
    tintBg: 'bg-brand-teal-tint',
    tintBorder: 'border-brand-teal/40',
    deepBg: 'hover:bg-brand-teal-deep',
    className: 'agent-teal',
  },
};

const DEFAULT: AgentAccent = PALETTE.amber;

/**
 * Resolve an agent's accent palette. Falls back to amber when the
 * agent's `accent` field is unset or names a color we haven't added.
 * @param name
 */
export function getAgentAccent(name: string | null | undefined): AgentAccent {
  if (!name) {
    return DEFAULT;
  }
  const key = name.toLowerCase() as AgentAccentName;
  return PALETTE[key] ?? DEFAULT;
}

/** All accent names currently recognized. Useful for the YAML lint. */
export function accentNames(): readonly AgentAccentName[] {
  return Object.keys(PALETTE) as AgentAccentName[];
}
