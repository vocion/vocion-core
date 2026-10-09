/**
 * A person's own Slack, read with THEIR user token: search their direct
 * messages (docs/guides/personal-connections.md). Read only — nothing here
 * posts, reacts or marks anything read.
 *
 * Slack's search runs over everything the token can see, channels included,
 * so the DM boundary is applied to what comes back: only matches whose
 * conversation is a direct message (`is_im`) or a group DM (`is_mpim`) leave
 * this file.
 */

const SEARCH_URL = 'https://slack.com/api/search.messages';
const TIMEOUT_MS = 20_000;

/** One direct message that matched. */
export type SlackDmHit = { from: string; text: string; at: string | null; link: string | null; with: string | null };

type SearchMatch = {
  username?: string;
  user?: string;
  text?: string;
  ts?: string;
  permalink?: string;
  channel?: { is_im?: boolean; is_mpim?: boolean; name?: string };
};

/** Slack said no, with its short error code. */
export class SlackCallError extends Error {
  constructor(public readonly code: string) {
    super(`Slack refused the search (${code})`);
    this.name = 'SlackCallError';
  }
}

/**
 * Search the person's direct and group-direct messages, newest first.
 * @param token - Their own user token (`xoxp-…`), from `personalCredential`.
 * @param query - Slack search words and modifiers (`from:@sam budget`).
 * @param max - How many matches to return, at most 20.
 */
export async function slackDmSearch(token: string, query: string, max = 10): Promise<SlackDmHit[]> {
  const limit = Math.min(Math.max(max, 1), 20);
  // Over-fetch: channel matches are dropped below, so ask for more than we keep.
  const params = new URLSearchParams({ query, count: String(Math.min(limit * 4, 100)), sort: 'timestamp', sort_dir: 'desc' });
  const res = await fetch(`${SEARCH_URL}?${params}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as { ok?: boolean; error?: string; messages?: { matches?: SearchMatch[] } };
  if (!body.ok) {
    throw new SlackCallError(body.error ?? 'unknown');
  }
  return (body.messages?.matches ?? [])
    .filter(m => m.channel?.is_im === true || m.channel?.is_mpim === true)
    .slice(0, limit)
    .map(m => ({
      from: m.username ?? m.user ?? 'someone',
      text: (m.text ?? '').slice(0, 1000),
      at: m.ts ? new Date(Number(m.ts.split('.')[0]) * 1000).toISOString() : null,
      link: m.permalink ?? null,
      with: m.channel?.is_mpim ? (m.channel.name ?? null) : null,
    }));
}
