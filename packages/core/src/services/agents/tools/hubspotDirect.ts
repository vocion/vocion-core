/**
 * Shared plumbing for the DIRECT-to-HubSpot tools (`hubspot_get_*`,
 * `hubspot_search_*`, `hubspot_list_*`, `hubspot_company_*`,
 * `hubspot_contact_emails`). These call the live API, never the mirror or
 * semantic search — the mirror keeps what it does better (exact counts,
 * facet breakdowns, sums) behind the `hubspot_count_*` tools in `crm.ts`.
 *
 * Access boundary: built only for agents whose `connectorSources` include a
 * hubspot source, AND (when a per-user ACL is set) only when that ACL also
 * permits a hubspot source. Credentials come from the source's vault entry
 * via `firstCredentialed`, exactly like the gmail/zoom live tools.
 *
 * Failures are data (see `libs/hubspot/client.ts`): no vaulted credential →
 * `no_hubspot_credentials`; a 403 → `missing_scope` naming the scope to
 * enable; anything else → `hubspot_error`.
 */

import type { RuntimeContext } from '../types';
import type { HubspotClient, HubspotFailure } from '@/libs/hubspot/client';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { createHubspotClient, noHubspotCredentials, tokenFromCredentials } from '@/libs/hubspot/client';
import { knowledgeSourceSchema } from '@/models/Schema';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { hasHubspotSource } from './crm';

/** A source slug that belongs to the HubSpot connector family. */
const HUBSPOT_SLUG = /^hubspot(?:$|-)/;

/**
 * Presence gate for the direct tools: the agent must have a hubspot source in
 * scope, and a per-user ACL (when set) must also allow one.
 * @param ctx
 */
export function hubspotDirectInScope(ctx: RuntimeContext): boolean {
  if (!hasHubspotSource(ctx)) {
    return false;
  }
  if (ctx.allowedSourceSlugs) {
    return ctx.allowedSourceSlugs.some(s => HUBSPOT_SLUG.test(s));
  }
  return true;
}

export type HubspotSourceRow = {
  id: number;
  slug: string;
  configJson: Record<string, unknown> | null;
};

/**
 * Every hubspot-family source in the org, with its config.
 * @param orgId
 */
export async function hubspotSourcesForOrg(orgId: string): Promise<HubspotSourceRow[]> {
  return db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      or(
        sql`${knowledgeSourceSchema.slug} ~ '^hubspot(-|$)'`,
        sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'hubspot'`,
      ),
    ));
}

export type CtxClient = {
  ok: true;
  client: HubspotClient;
  /** The source whose vault credential the client runs on. */
  sourceSlug: string;
  /** All hubspot-family sources (for config like stallThresholds). */
  sources: HubspotSourceRow[];
};

/**
 * Resolve a live HubSpot client for this org from the first credentialed
 * hubspot source. `{ok:false}` results are returned to the model verbatim.
 * @param ctx
 */
export async function hubspotClientForCtx(ctx: RuntimeContext): Promise<CtxClient | HubspotFailure> {
  const sources = await hubspotSourcesForOrg(ctx.orgId);
  if (sources.length === 0) {
    return noHubspotCredentials('No HubSpot source is connected in this workspace, so live HubSpot reads are unavailable. Say that rather than guessing.');
  }
  for (const source of sources) {
    const credentials = await getCredentialsForSource(ctx.orgId, source.slug);
    const token = tokenFromCredentials(credentials as Record<string, unknown> | undefined);
    if (token) {
      const baseUrl = typeof source.configJson?.baseUrl === 'string' ? source.configJson.baseUrl : undefined;
      return { ok: true, client: createHubspotClient({ token, baseUrl }), sourceSlug: source.slug, sources };
    }
  }
  return noHubspotCredentials();
}

/**
 * Serialize any tool payload the way every domain tool does.
 * @param payload
 */
export function asJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * The query's alphanumeric tokens, longest first — the longest token is the
 * most distinctive ("Corporation" over "the"), used to broaden a missed
 * multi-word search once before concluding nothing exists.
 * @param query
 */
export function distinctiveTokens(query: string): string[] {
  return query
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * Clamp a limit argument into [1, max] with a default.
 * @param raw
 * @param fallback
 * @param max
 */
export function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  const n = Number.isFinite(raw) ? Math.trunc(raw!) : fallback;
  return Math.max(1, Math.min(n || fallback, max));
}

/* ------------------------------------------------------------------ */
/* Engagement-timeline filters (Phase 3) — signal over noise, shared   */
/* by hubspot_contact_emails and hubspot_company_activity.             */
/* ------------------------------------------------------------------ */

/**
 * HubSpot stores note/meeting/call/email bodies as HTML — strip tags and
 * entities to plain text, collapsing whitespace.
 * @param raw
 */
export function stripHtml(raw: string | null | undefined): string {
  const noTags = (raw ?? '').replace(/<[^>]+>/g, ' ');
  const unescaped = noTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, '\'');
  return unescaped.replace(/\s+/g, ' ').trim();
}

/**
 * Out-of-office / automatic replies carry no relationship signal — dropped
 * from timelines entirely so real replies are not crowded out.
 */
const AUTOREPLY_SUBJECT = /^\s*(?:auto(?:matic)? reply|out of office|auto:)/i;

/**
 * True for an out-of-office / automatic-reply email.
 * @param subject
 * @param body
 */
export function isAutoReply(subject: string | null | undefined, body: string | null | undefined): boolean {
  if (AUTOREPLY_SUBJECT.test(subject ?? '')) {
    return true;
  }
  return (body ?? '').toLowerCase().includes('out of the office');
}

/**
 * A meeting/call body that is just an auto-generated calendar or
 * video-conference JOIN INVITE, not discussion — the informative title is
 * kept, this boilerplate snippet is blanked.
 */
const MEETING_BOILERPLATE = new RegExp([
  'is inviting you to a scheduled Zoom meeting',
  'Join Zoom Meeting',
  'Microsoft Teams',
  'Need help\\?? Join the meeting',
  'Join the meeting now',
  'Meeting ID:\\s*[\\d ]{6,}',
  'Dial in by',
  'One tap mobile',
  'Google Meet',
].join('|'), 'i');

/**
 * True when a meeting/call body is calendar/video-conference boilerplate.
 * @param text
 */
export function isMeetingBoilerplate(text: string): boolean {
  return text !== '' && MEETING_BOILERPLATE.test(text);
}

/**
 * Email direction, DERIVED from HubSpot's own engagement data, never
 * configured: INCOMING_EMAIL is mail the portal received; everything else
 * (EMAIL, FORWARDED_EMAIL) was sent by one of the portal's own owners or
 * connected inboxes → "out".
 * @param direction
 */
export function emailDirection(direction: string | null | undefined): 'in' | 'out' {
  return (direction ?? '').toUpperCase().includes('INCOMING') ? 'in' : 'out';
}

/**
 * A short plain-text preview of an email body (prefer text; strip HTML).
 * @param textBody
 * @param htmlBody
 * @param n
 */
export function emailSnippet(textBody: string | null | undefined, htmlBody: string | null | undefined, n = 240): string {
  const body = (textBody ?? '').trim() !== '' ? (textBody ?? '').replace(/\s+/g, ' ').trim() : stripHtml(htmlBody);
  return body.length > n ? `${body.slice(0, n)}…` : body;
}
