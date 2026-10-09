import type { AgentOption } from './types';
import { turnAttribution } from './routing';

/**
 * WHO IS SPEAKING, turn by turn — the agent avatars in chat (founder,
 * 2026-10-09), drawn with the same `AgentDot` as the empty chat's team.
 *
 * A turn opens with its speaker's avatar and name ("Dana · Pricing") only when
 * the speaker CHANGES to a teammate — the lead handed off or routed to a
 * specialist. The same speaker's next turns keep the quiet brand mark, and so
 * does the lead (founder, 2026-09-18: no name on every turn).
 *
 * Pure, so the transcript, the writing line and the tests agree.
 */

/** An agent as an avatar draws it. */
export type Speaker = { slug?: string; name: string; accent: string | null; eyebrow?: string };

/**
 * An agent's avatar identity from the surface's roster, by slug or by name.
 * @param agents - The surface's agents.
 * @param who - The slug and/or name the turn or step carries.
 * @param who.slug - The agent's slug, when known.
 * @param who.name - Its name, when the slug is not known.
 */
export function speakerOf(agents: readonly AgentOption[] | undefined, who: { slug?: string; name?: string }): Speaker | null {
  const known = (who.slug ? agents?.find(a => a.slug === who.slug) : undefined) ?? (who.name ? agents?.find(a => a.name === who.name) : undefined);
  const name = known?.name ?? who.name;
  if (!name) {
    return null;
  }
  return { ...(known?.slug || who.slug ? { slug: known?.slug ?? who.slug } : {}), name, accent: known?.accent ?? null, ...(known?.eyebrow ? { eyebrow: known.eyebrow } : {}) };
}

/**
 * For each turn of a transcript: whether it opens with its speaker's avatar
 * (a change to a teammate), and who is speaking it (for the writing line).
 * @param turns - The transcript, in order.
 * @param own - The surface's own agent: the lead, whose turns stay quiet.
 * @param own.slug - Its slug.
 * @param own.name - Its name.
 * @param agents - The surface's agents.
 */
export function speakersOf(
  turns: ReadonlyArray<{ role: string; agentSlug?: string; agentName?: string }>,
  own: { slug?: string; name: string },
  agents?: readonly AgentOption[],
): Array<{ opener: Speaker | null; speaker: Speaker | null }> {
  let previous: string | null = null;
  return turns.map((turn) => {
    if (turn.role !== 'assistant') {
      return { opener: null, speaker: null };
    }
    const teammate = turnAttribution(turn, own);
    const key = teammate ? (turn.agentSlug ?? teammate) : (own.slug ?? own.name);
    const speaker = teammate ? speakerOf(agents, { slug: turn.agentSlug, name: teammate }) : speakerOf(agents, { slug: own.slug, name: own.name });
    const opener = teammate && key !== previous ? speaker : null;
    previous = key;
    return { opener, speaker };
  });
}
