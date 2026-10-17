#!/usr/bin/env tsx
/**
 * Rewrite the nurture slots of contacts still in a ladder rung into the
 * shape HubSpot renders reliably (`hubspotEmailHtml`).
 *
 * Slots are written at Enroll, so a contact enrolled before a fix to the
 * body's shape keeps the old shape for every step still to send: plain text
 * whose newlines the token drops, or bare `<p>` that leans on margins HubSpot
 * zeroes. This re-renders those values. The words are untouched: the same
 * function the slot write uses converts the stored body, and a value already
 * in the new shape converts to itself, so a second run changes nothing.
 *
 * Reads HubSpot only; the platform's records are not needed. Lists first;
 * writes only with --apply.
 *
 *   npx dotenv -c -- tsx src/scripts/rewrite-nurture-slots.ts --org <project id> [--apply]
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import 'dotenv/config';

/**
 * A body's words, whatever its markup: what must not change.
 * @param body - Prose or HTML.
 */
function words(body: string): string {
  return body
    .replaceAll(/<\/?(?:[au]|strong|em|[sbi]|span)\b[^>]*>/gi, '')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { org: { type: 'string' }, apply: { type: 'boolean', default: false } } });
  if (!values.org) {
    console.error('--org <project id> is required');
    process.exit(2);
  }
  const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
  const { isNurtureSequence, readNurtureSlotsConfig } = await import('@/libs/hubspot/nurtureSlots');
  const { listSequences, resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
  const { senderConfigOf } = await import('@/libs/hubspot/senderInboxes');
  const { hubspotEmailHtml } = await import('@/libs/writing/emailBody');
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');

  const resolved = await hubspotClientForOrg(values.org);
  if (!resolved.ok) {
    throw new Error(`no HubSpot credentials for ${values.org}`);
  }
  const hs = resolved.client;
  const [source] = await db.select({ configJson: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, values.org), eq(knowledgeSourceSchema.slug, 'hubspot-contacts'))).limit(1);
  const cfg = readNurtureSlotsConfig((source?.configJson as { nurtureSlots?: unknown } | null)?.nurtureSlots);
  // The rungs, from the sender's library: only a contact in a rung sends its slots.
  const sender = senderConfigOf(source?.configJson as never);
  const user = sender ? await resolveHubspotUserId(hs, sender.user) : null;
  const library = user?.ok ? await listSequences(hs, user.data.userId) : null;
  const rungIds = library?.ok ? library.data.filter(q => isNurtureSequence(q.name.replace(/^Archived:\s*/i, ''), cfg)).map(q => q.id) : [];
  if (rungIds.length === 0) {
    throw new Error('no Personalized Nurture rungs found in the sender\'s library');
  }
  const bodyProps = Array.from({ length: cfg.maxSlots }, (_, i) => cfg.bodyProperty.replaceAll('{n}', String(i + 1)));

  // Contacts in a rung right now.
  const changes: Array<{ id: string; email: string; properties: Record<string, string> }> = [];
  let after: string | undefined;
  let seen = 0;
  do {
    const page = await hs.post<{ results?: Array<{ id: string; properties: Record<string, string | null> }>; paging?: { next?: { after?: string } } }>('/crm/v3/objects/contacts/search', {
      filterGroups: [{ filters: [
        { propertyName: 'hs_sequences_is_enrolled', operator: 'EQ', value: 'true' },
        { propertyName: 'hs_latest_sequence_enrolled', operator: 'IN', values: rungIds },
        { propertyName: bodyProps[0]!, operator: 'HAS_PROPERTY' },
      ] }],
      properties: ['email', ...bodyProps],
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (!page.ok) {
      throw new Error(page.message);
    }
    for (const c of page.data.results ?? []) {
      seen += 1;
      const properties: Record<string, string> = {};
      for (const prop of bodyProps) {
        const value = c.properties[prop];
        const next = value ? hubspotEmailHtml(value) : value;
        if (value && next && next !== value) {
          // The words must come through untouched; a value that would change
          // them is reported and left alone.
          if (words(next) !== words(value)) {
            console.warn(`  ${c.id} ${prop}: left alone, the words would change`);
            continue;
          }
          properties[prop] = next;
        }
      }
      if (Object.keys(properties).length > 0) {
        changes.push({ id: c.id, email: c.properties.email ?? '', properties });
      }
    }
    after = page.data.paging?.next?.after;
  } while (after);

  console.warn(`${seen} contact(s) are in a rung now; ${changes.length} need their slots re-rendered.`);
  for (const c of changes) {
    console.warn(`  ${c.id} ${c.email}: ${Object.keys(c.properties).join(', ')}`);
  }
  if (!values.apply) {
    console.warn('\nDry run. Re-run with --apply to write.');
    return;
  }
  for (let i = 0; i < changes.length; i += 100) {
    const res = await hs.post('/crm/v3/objects/contacts/batch/update', { inputs: changes.slice(i, i + 100).map(c => ({ id: c.id, properties: c.properties })) });
    if (!res.ok) {
      throw new Error(res.message);
    }
  }
  console.warn(`\nRewrote ${changes.length} contact(s).`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
