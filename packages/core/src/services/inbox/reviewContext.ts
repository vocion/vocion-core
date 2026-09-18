/**
 * Read what a reviewer needs beside an email proposal — the CRM contact, the
 * emails already exchanged (CRM-logged and mailbox-mirrored), the sequence
 * the contact is in — and shape it with `buildReviewContext`.
 *
 * Every read resolves the org's own credential (CLAUDE.md: the stored key
 * first, never a cached client) and every failure is carried into the model
 * in the system's own words rather than swallowed: "HubSpot: missing_scope
 * sales-email-read" is a fact the reviewer can act on; an empty rail is not.
 */

import type { ContactFacts, ReviewContextModel, Section, Touch } from './reviewContextModel';
import type { ReviewRow } from './reviewRows';
import type { HubspotClient } from '@/libs/hubspot/client';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { getContactEnrollment } from '@/libs/hubspot/sequences';
import { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';
import { emailDirection, emailSnippet, hubspotClientForOrg, hubspotSourcesForOrg, isAutoReply } from '@/services/agents/tools/hubspotDirect';
import { buildReviewContext, contactEmailOf } from './reviewContextModel';

const CONTACT_PROPERTIES = ['firstname', 'lastname', 'email', 'company', 'jobtitle', 'lifecyclestage', 'hubspot_owner_id', 'createdate', 'hs_analytics_source', 'hs_analytics_source_data_1'];
const EMAIL_PROPERTIES = ['hs_email_subject', 'hs_email_text', 'hs_email_html', 'hs_email_direction', 'hs_timestamp'];
/** Enough to see the pattern; the CRM has the rest. */
const TOUCH_CAP = 8;

type RawContact = { id: string; properties?: Record<string, string | null> };
type SearchBody = { results?: RawContact[] };
type AssocPage = { results?: Array<{ toObjectId?: string | number; id?: string | number }> };
type EmailBatch = { results?: Array<{ id: string; properties?: Record<string, string | null> }> };

/**
 * The context beside one proposal. Never throws — a system that cannot be
 * read is a section that says so.
 * @param orgId - Tenant.
 * @param row - The proposal, as the review queue describes it.
 */
export async function loadReviewContext(orgId: string, row: ReviewRow): Promise<ReviewContextModel> {
  const email = contactEmailOf({ actionId: row.actionId, input: row.input, recordKey: row.described.record?.key ?? null });
  if (!email) {
    return buildReviewContext({ email: null, contact: { status: 'none' }, hubspotTouches: { status: 'none' }, mirrorTouches: { status: 'none' }, enrollment: { status: 'none' } });
  }
  const [hubspot, mirrorTouches] = await Promise.all([readHubspot(orgId, email), readMirror(orgId, email)]);
  return buildReviewContext({ email, ...hubspot, mirrorTouches });
}

async function readHubspot(orgId: string, email: string): Promise<{ contact: Section<ContactFacts>; hubspotTouches: Section<Touch[]>; enrollment: Section<import('./reviewContextModel').EnrollmentFacts> }> {
  const resolved = await hubspotClientForOrg(orgId);
  if (!resolved.ok) {
    const section = resolved.error === 'no_hubspot_credentials' ? { status: 'not-connected' as const } : { status: 'error' as const, message: resolved.message };
    return { contact: section, hubspotTouches: section, enrollment: section };
  }
  const client = resolved.client;
  const found = await client.post<SearchBody>('/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: CONTACT_PROPERTIES,
    limit: 1,
  });
  if (!found.ok) {
    const section = { status: 'error' as const, message: found.message };
    return { contact: section, hubspotTouches: section, enrollment: section };
  }
  const raw = (found.data.results ?? [])[0];
  if (!raw) {
    return { contact: { status: 'none' }, hubspotTouches: { status: 'none' }, enrollment: { status: 'none' } };
  }
  const portalId = (await hubspotSourcesForOrg(orgId)).map(s => s.configJson?.portalId).find((p): p is string => typeof p === 'string') ?? null;
  const p = raw.properties ?? {};
  const contact: ContactFacts = {
    hubspotId: raw.id,
    name: [p.firstname, p.lastname].filter(Boolean).join(' ') || null,
    email: p.email ?? email,
    company: p.company ?? null,
    jobTitle: p.jobtitle ?? null,
    lifecycleStage: p.lifecyclestage ?? null,
    owner: p.hubspot_owner_id ?? null,
    createdAt: p.createdate ?? null,
    source: p.hs_analytics_source ?? null,
    sourceDetail: p.hs_analytics_source_data_1 ?? null,
    href: portalId ? `https://app.hubspot.com/contacts/${portalId}/record/0-1/${raw.id}` : null,
  };
  const [hubspotTouches, enrollment] = await Promise.all([readHubspotEmails(client, raw.id), readEnrollment(client, raw.id)]);
  return { contact: { status: 'ok', data: contact }, hubspotTouches, enrollment };
}

async function readHubspotEmails(client: HubspotClient, contactId: string): Promise<Section<Touch[]>> {
  const assoc = await client.get<AssocPage>(`/crm/v3/objects/contacts/${contactId}/associations/emails`, { limit: '100' });
  if (!assoc.ok) {
    return { status: 'error', message: assoc.message };
  }
  const ids = (assoc.data.results ?? []).map(r => r.toObjectId ?? r.id).filter((x): x is string | number => x !== undefined && x !== null).map(String).slice(0, 100);
  if (ids.length === 0) {
    return { status: 'none' };
  }
  const read = await client.post<EmailBatch>('/crm/v3/objects/emails/batch/read', { properties: EMAIL_PROPERTIES, inputs: ids.map(id => ({ id })) });
  if (!read.ok) {
    return { status: 'error', message: read.message };
  }
  const touches: Touch[] = [];
  for (const r of read.data.results ?? []) {
    const p = r.properties ?? {};
    const subject = (p.hs_email_subject ?? '').trim();
    if (isAutoReply(subject, p.hs_email_text ?? p.hs_email_html)) {
      continue;
    }
    touches.push({ direction: emailDirection(p.hs_email_direction), subject, snippet: emailSnippet(p.hs_email_text, p.hs_email_html, 160), at: p.hs_timestamp ?? null, source: 'hubspot', href: null });
  }
  touches.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return touches.length > 0 ? { status: 'ok', data: touches.slice(0, TOUCH_CAP) } : { status: 'none' };
}

async function readEnrollment(client: HubspotClient, contactId: string): Promise<Section<import('./reviewContextModel').EnrollmentFacts>> {
  const res = await getContactEnrollment(client, contactId);
  if (!res.ok) {
    return { status: 'error', message: res.message };
  }
  return { status: 'ok', data: { enrolled: res.data.enrolled, sequenceName: res.data.sequenceName ?? null, enrolledBy: res.data.enrolledByEmail ?? null } };
}

/**
 * The mailbox mirror: Gmail threads and messages the workspace ingested that
 * name this address. Direction is read off the sender — from them is `in`,
 * anything else in a thread that names them is our side writing.
 * @param orgId
 * @param email
 */
async function readMirror(orgId: string, email: string): Promise<Section<Touch[]>> {
  const sources = await db.select({ id: knowledgeSourceSchema.id }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, 'gmail')));
  if (sources.length === 0) {
    return { status: 'not-connected' };
  }
  try {
    const pattern = `%${email.replace(/[%_]/g, '')}%`;
    const rows = await db
      .selectDistinctOn([knowledgeDocumentSchema.id], {
        id: knowledgeDocumentSchema.id,
        title: knowledgeDocumentSchema.title,
        metadata: knowledgeDocumentSchema.metadata,
        at: knowledgeDocumentSchema.lastModifiedAt,
        snippet: sql<string>`left(${knowledgeChunkSchema.content}, 400)`,
      })
      .from(knowledgeDocumentSchema)
      .innerJoin(knowledgeChunkSchema, eq(knowledgeChunkSchema.documentId, knowledgeDocumentSchema.id))
      .where(and(
        eq(knowledgeDocumentSchema.orgId, orgId),
        sql`${knowledgeDocumentSchema.sourceId} in (${sql.join(sources.map(s => sql`${s.id}`), sql`, `)})`,
        or(ilike(sql`${knowledgeDocumentSchema.metadata}->>'from'`, pattern), ilike(knowledgeChunkSchema.content, pattern)),
      ))
      .orderBy(knowledgeDocumentSchema.id, desc(knowledgeDocumentSchema.lastModifiedAt))
      .limit(40);
    const touches: Touch[] = rows
      .map((r) => {
        const from = String((r.metadata as Record<string, unknown>).from ?? '');
        return {
          direction: from.toLowerCase().includes(email) ? 'in' as const : 'out' as const,
          subject: (r.title ?? '').replace(/\s\(\d+ messages?\)$/, ''),
          snippet: (r.snippet ?? '').replace(/^(From|To|Cc|Date|Subject):.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160),
          at: r.at?.toISOString() ?? null,
          source: 'gmail' as const,
          href: `/dashboard/search?q=${encodeURIComponent(r.title ?? email)}`,
        };
      })
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      .slice(0, TOUCH_CAP);
    return touches.length > 0 ? { status: 'ok', data: touches } : { status: 'none' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'the mailbox mirror could not be read' };
  }
}
