#!/usr/bin/env tsx
/**
 * Prove a personalized send arrives as it was approved: run the REAL Enroll
 * path (propose → execute `personalization.enroll`) into test contacts, then
 * read back what HubSpot stored in the nurture slot and what it actually
 * sent, and compare both with what the body should become.
 *
 * Each fixture is a body shape that has gone wrong before, or could: a
 * greeting on its own line, Windows line endings, markdown a model wrote,
 * the editor's HTML (empty paragraphs, paragraphs inside list items), runs
 * of `<br>`, a bare link, characters that must stay escaped. The fixture is
 * written as send 1 of a ladder rung, because a rung's first email goes out
 * at enrollment; sends 2..n carry a short filler body so the draft matches
 * the rung's email count.
 *
 * Every enrollment goes through the workspace's own inbox routing, so a run
 * also says which inbox each email left from. `--cleanup` deletes the test
 * contacts afterwards (which ends their enrollments) and the tasks the
 * sequence created on them.
 *
 * It sends real email, to the address you give it, plus-addressed per
 * fixture. Never point it at anyone else's address.
 *
 *   npx dotenv -c -- tsx src/scripts/prove-sequence-format-e2e.ts \
 *     --org <project id> --to you@example.com --sequence <rung id> [--only greeting,markdown] [--cleanup]
 */
import process from 'node:process';
import { parseArgs } from 'node:util';
import 'dotenv/config';

type Fixture = { key: string; body: string; expect: { paragraphs?: number; lists?: number; links?: number; bold?: boolean; literal?: string[] } };

/** Body shapes, each with what the sent email must and must not carry. */
export const FIXTURES: Fixture[] = [
  { key: 'greeting', body: 'Dana,\nWhere would you say the team stands on AI today?', expect: { paragraphs: 2 } },
  { key: 'paragraphs', body: 'Dana,\n\nNorthwind runs approvals by hand.\n\nWorth a look together?', expect: { paragraphs: 3 } },
  { key: 'crlf', body: 'Dana,\r\n\r\nFirst paragraph.\r\nSecond paragraph.', expect: { paragraphs: 3 } },
  { key: 'markdown', body: 'Dana,\n\nTwo places it shows up:\n- **Triage** on new tickets\n- *Dispatch* the same day\n\nWorth a look?', expect: { paragraphs: 3, lists: 1, bold: true, literal: ['**', '- '] } },
  { key: 'editor', body: '<p>Dana,</p><p></p><p>A <strong>two-week</strong> look at one workflow.</p><ul><li><p>Approvals</p></li><li><p>Handoffs</p></li></ul><p>Worth it?<br></p>', expect: { paragraphs: 3, lists: 1, bold: true } },
  { key: 'breaks', body: '<p>Dana,<br><br>One paragraph the editor kept as breaks.<br></p><p>Another.</p>', expect: { paragraphs: 3 } },
  { key: 'link', body: 'Dana,\nThe readiness assessment takes five minutes: https://www.metacto.com/tools/ai-readiness-assessment', expect: { paragraphs: 2, links: 1 } },
  { key: 'characters', body: 'Dana,\nWorth < 20 minutes & a "quick" look at Northwind\'s queue?', expect: { paragraphs: 2, literal: ['&lt;', '&amp;amp;'] } },
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      org: { type: 'string' },
      to: { type: 'string' },
      sequence: { type: 'string' },
      only: { type: 'string' },
      cleanup: { type: 'boolean', default: false },
    },
  });
  if (!values.org || !values.to?.includes('@') || !values.sequence) {
    console.error('--org, --to <your address> and --sequence <Personalized Nurture rung id> are required');
    process.exit(2);
  }
  const orgId = values.org;
  const [local, domain] = values.to.split('@') as [string, string];
  const only = values.only ? new Set(values.only.split(',')) : null;
  const fixtures = FIXTURES.filter(f => !only || only.has(f.key));

  const { hubspotClientForOrg } = await import('@/services/agents/tools/hubspotDirect');
  const { getSequence, resolveHubspotUserId } = await import('@/libs/hubspot/sequences');
  const { senderConfigOf } = await import('@/libs/hubspot/senderInboxes');
  const { executeAction, proposeAction } = await import('@/services/ActionService');
  const { linkRewriterFor } = await import('@/services/personalization/assetCatalog');
  const { hubspotEmailHtml } = await import('@/libs/writing/emailBody');
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { knowledgeSourceSchema } = await import('@/models/Schema');

  const resolved = await hubspotClientForOrg(orgId);
  if (!resolved.ok) {
    throw new Error(`no HubSpot credentials for ${orgId}`);
  }
  const hs = resolved.client;
  const [contacts] = await db.select({ configJson: knowledgeSourceSchema.configJson }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, 'hubspot-contacts'))).limit(1);
  const sender = senderConfigOf(contacts?.configJson as never);
  if (!sender) {
    throw new Error('the contacts source names no sender');
  }
  const user = await resolveHubspotUserId(hs, sender.user);
  if (!user.ok) {
    throw new Error(user.message);
  }
  const rung = await getSequence(hs, values.sequence, user.data.userId);
  if (!rung.ok || !rung.data.emailStepCount) {
    throw new Error(`sequence ${values.sequence} could not be read with its steps`);
  }
  const rewrite = await linkRewriterFor(orgId);
  console.warn(`Rung "${rung.data.name}", ${rung.data.emailStepCount} emails. Sending ${fixtures.length} fixture(s) to ${local}+fmt-<case>@${domain}.\n`);

  const rows: Array<{ key: string; inbox?: string; stored: boolean; sent: string; problems: string[]; contactId?: string }> = [];
  for (const f of fixtures) {
    const email = `${local}+fmt-${f.key}@${domain}`;
    const problems: string[] = [];
    const found = await hs.post<{ results?: Array<{ id: string }> }>('/crm/v3/objects/contacts/search', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }], limit: 1 });
    let contactId = found.ok ? found.data.results?.[0]?.id : undefined;
    if (!contactId) {
      const made = await hs.post<{ id: string }>('/crm/v3/objects/contacts', { properties: { email, firstname: 'Format', lastname: `Test ${f.key}` } });
      if (!made.ok) {
        rows.push({ key: f.key, stored: false, sent: 'contact not created', problems: [made.message] });
        continue;
      }
      contactId = made.data.id;
    }
    const sends = Array.from({ length: rung.data.emailStepCount }, (_, i) => ({
      step: i + 1,
      subject: i === 0 ? `Format test: ${f.key}` : `Format test filler ${i + 1}`,
      body: i === 0 ? f.body : 'Filler for a later step.',
    }));
    const proposed = await proposeAction({
      orgId,
      actionId: 'personalization.enroll',
      principal: { kind: 'agent', id: 'agent:format-proof', scope: { orgId }, grants: ['*'], autonomy: 2 },
      input: { leadBriefId: 0, contactRef: `contacts:${contactId}`, contactName: `Format Test ${f.key}`, sequenceId: rung.data.id, sequenceName: rung.data.name, senderEmail: sender.user, hubspotUserId: user.data.userId, sends },
    });
    if (!proposed.runId || proposed.status !== 'pending') {
      rows.push({ key: f.key, stored: false, sent: 'not proposed', problems: [JSON.stringify(proposed).slice(0, 300)], contactId });
      continue;
    }
    const run = await executeAction(proposed.runId, orgId, { reviewedBy: 'format-proof' });
    if (run.status !== 'done') {
      rows.push({ key: f.key, stored: false, sent: 'not enrolled', problems: [String(run.error)], contactId });
      continue;
    }
    const inbox = String((run.result as { senderEmail?: string }).senderEmail);

    // What HubSpot stored: exactly what the boundary wrote.
    const want = hubspotEmailHtml(f.body, rewrite ? { rewriteHref: rewrite } : {});
    const slot = await hs.get<{ properties: Record<string, string | null> }>(`/crm/v3/objects/contacts/${contactId}`, { properties: 'pn_email_1_body' });
    const stored = slot.ok && slot.data.properties.pn_email_1_body === want;
    if (!stored) {
      problems.push(`slot differs: ${slot.ok ? JSON.stringify(slot.data.properties.pn_email_1_body).slice(0, 200) : slot.message}`);
    }

    // What HubSpot sent: the logged email on the contact, polled for two minutes.
    let html = '';
    for (let i = 0; i < 24 && !html; i += 1) {
      await new Promise(r => setTimeout(r, 5_000));
      const assoc = await hs.get<{ results?: Array<{ toObjectId: string | number }> }>(`/crm/v4/objects/contacts/${contactId}/associations/emails`);
      for (const a of assoc.ok ? assoc.data.results ?? [] : []) {
        const e = await hs.get<{ properties: Record<string, string | null> }>(`/crm/v3/objects/emails/${a.toObjectId}`, { properties: 'hs_email_subject,hs_email_html' });
        if (e.ok && e.data.properties.hs_email_subject === `Format test: ${f.key}`) {
          html = e.data.properties.hs_email_html ?? '';
        }
      }
    }
    if (!html) {
      rows.push({ key: f.key, inbox, stored, sent: 'no email within 2 minutes', problems, contactId });
      continue;
    }
    const body = (/data-top-level="true">([\s\S]*?)<\/div>\s*<div data-hs-signature/.exec(html)?.[1] ?? html);
    const words = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].filter(m => words(m[1]!) !== '').length;
    const lists = (body.match(/<(ul|ol)\b/gi) ?? []).length;
    const links = (body.match(/<a\s[^>]*href=/gi) ?? []).length;
    if (f.expect.paragraphs !== undefined && paragraphs !== f.expect.paragraphs) {
      problems.push(`${paragraphs} paragraphs, expected ${f.expect.paragraphs}`);
    }
    if (f.expect.lists !== undefined && lists !== f.expect.lists) {
      problems.push(`${lists} lists, expected ${f.expect.lists}`);
    }
    if (f.expect.links !== undefined && links !== f.expect.links) {
      problems.push(`${links} links, expected ${f.expect.links}`);
    }
    if (f.expect.bold && !/<strong>/.test(body)) {
      problems.push('bold lost');
    }
    if (!/data-hs-signature/.test(html)) {
      problems.push('no signature');
    }
    for (const lit of f.expect.literal ?? []) {
      const text = words(body);
      if (lit === '&lt;' ? !body.includes('&lt;') : text.includes(lit)) {
        problems.push(lit === '&lt;' ? 'the "<" was not escaped' : `literal "${lit}" in the text`);
      }
    }
    rows.push({ key: f.key, inbox, stored, sent: `${paragraphs}p ${lists}l ${links}a`, problems, contactId });
  }

  console.warn('fixture      inbox                        slot  sent          result');
  for (const r of rows) {
    console.warn(`${r.key.padEnd(12)} ${(r.inbox ?? '-').padEnd(28)} ${r.stored ? 'ok  ' : 'BAD '} ${r.sent.padEnd(13)} ${r.problems.length ? `FAIL: ${r.problems.join('; ')}` : 'pass'}`);
  }

  if (values.cleanup) {
    const ids = rows.flatMap(r => (r.contactId ? [r.contactId] : []));
    for (const id of ids) {
      const tasks = await hs.get<{ results?: Array<{ toObjectId: string | number }> }>(`/crm/v4/objects/contacts/${id}/associations/tasks`);
      const taskIds = (tasks.ok ? tasks.data.results ?? [] : []).map(t => ({ id: String(t.toObjectId) }));
      if (taskIds.length > 0) {
        await hs.post('/crm/v3/objects/tasks/batch/archive', { inputs: taskIds });
      }
    }
    if (ids.length > 0) {
      await hs.post('/crm/v3/objects/contacts/batch/archive', { inputs: ids.map(id => ({ id })) });
    }
    console.warn(`\nDeleted ${ids.length} test contact(s) and their tasks.`);
  }
  const failed = rows.filter(r => !r.stored || r.problems.length > 0).length;
  console.warn(`\n${rows.length - failed} of ${rows.length} fixture(s) passed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
