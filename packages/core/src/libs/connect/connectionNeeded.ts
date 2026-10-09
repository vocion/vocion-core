/**
 * WHAT AGENTS TRIED AND FAILED — a tool call that could not run because a
 * system is not connected (or its connection stopped working), read from the
 * call's own words.
 *
 * A connector tool that has nothing to read says so in a sentence ("No
 * HubSpot source is connected in this workspace…", "The GitHub credential
 * this connector uses has expired…"), and a thrown one carries the same in
 * its error. This reads that sentence and names the connector: the one the
 * text names, else the one the tool is named for. Pure, so the agent loop
 * that records it and the tests agree on what counts.
 *
 * Tools that LIST connections (`list_capabilities`, `describe_setup`, the
 * connect tools themselves) say "not connected" about everything they list;
 * they are never a failed attempt.
 */

/** The tools whose output names unconnected systems by design. */
const LISTING_TOOLS = new Set(['list_capabilities', 'describe_setup', 'describe_sources', 'offer_connection', 'connect_system', 'connect_personal']);

/** A sentence that says a system is missing or its connection is broken. */
const NEEDS_CONNECTION = /\b(?:not (?:yet )?connected|isn'?t connected|no (?:[\w .-]{1,40}? )?(?:source|connection|account|login|credentials?) (?:is )?(?:connected|configured|set up)|no (?:\w+ )?credentials? (?:for|configured)|credential[\w ]{0,40}? (?:was revoked|has expired|is expired|no longer exists)|(?:connect|reconnect) [\w .-]{1,40}? (?:first|to (?:read|use|post|send))|needs? (?:a|the) [\w .-]{1,40}? connection)\b/i;

/**
 * Whether a tool's words say a system is missing or its connection is
 * broken — the cheap first check, before any connector is looked for.
 * @param text - What the tool returned, or the error it threw.
 */
export function saysConnectionMissing(text: string): boolean {
  return Boolean(text) && NEEDS_CONNECTION.test(text);
}

/**
 * Which connector a tool call needed and did not have, or null when the call
 * did not fail for want of a connection.
 * @param tool - The tool's name.
 * @param text - What it returned, or the error it threw.
 * @param connectors - The connectors a workspace can connect (slug and name).
 */
export function connectorNeededBy(tool: string, text: string, connectors: ReadonlyArray<{ slug: string; name?: string | null }>): string | null {
  if (LISTING_TOOLS.has(tool) || !saysConnectionMissing(text)) {
    return null;
  }
  const lower = text.toLowerCase();
  // The system the sentence names, earliest first ("No HubSpot source…").
  let named: { slug: string; at: number } | null = null;
  for (const c of connectors) {
    for (const word of [c.name, c.slug].filter((w): w is string => Boolean(w && w.length >= 3))) {
      const at = lower.search(new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
      if (at >= 0 && (!named || at < named.at)) {
        named = { slug: c.slug, at };
      }
    }
  }
  if (named) {
    return named.slug;
  }
  // Else the system the tool is named for: `github_pull_read`, `hubspotDeals`.
  const parts = tool.split(/[_\-.]|(?=[A-Z])/).map(p => p.toLowerCase()).filter(Boolean);
  const byTool = connectors.find(c => parts.includes(c.slug.toLowerCase()));
  return byTool?.slug ?? null;
}

/**
 * "Agents tried to use it 3 times this week and couldn't" — the fact in words.
 * @param times - How many failed calls.
 * @param name - The system's name, where "it" would not say which.
 */
export function triedLine(times: number, name?: string): string {
  const it = name ?? 'it';
  return times === 1 ? `An agent tried to use ${it} this week and couldn't` : `Agents tried to use ${it} ${times} times this week and couldn't`;
}
