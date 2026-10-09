#!/usr/bin/env tsx
/**
 * seed-goals-fixtures — goals to draw, for `e2e/goals/*.spec.ts` and the
 * screenshots in `docs/guides/goals.md`.
 *
 * One Org (Northwind Trading), Robin Vale who can sign in, a teammate, two
 * workspaces (GTM and Partners) and Robin's Personal, made at sign-in. Goals:
 *   - GTM: "Follow up with Northwind Expo contacts" — measured by a saved
 *     view over 40 synced mail threads, 12 of them contacted;
 *   - GTM: "Expand vertical GTM strategy" — five milestones, two done, weekly review;
 *   - GTM: a teammate's goal, so the list's Mine / Everyone has something to say;
 *   - Partners: "Build referral partner collateral" — one milestone done by
 *     its linked artifact;
 *   - Partners: "Activate referral partners" — set twelve days ago and quiet
 *     since: a stalled goal.
 * Fictional names only (`libs/fixtures/realDataGuard.ts`). Idempotent: a
 * rerun deletes this script's own rows first.
 *
 * Usage: npx dotenv -c -- npx tsx e2e/goals/support/seed-goals-fixtures.ts
 */
import process from 'node:process';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { MAIL_THREAD_STATE_KIND } from '@/libs/retrieval/facets';
import { accountMembershipSchema, artifactSchema, conversationSchema, goalSchema, knowledgeDocumentSchema, knowledgeSourceSchema, projectSchema, stateViewSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

const ACCOUNT = { slug: 'e2e-goals', name: 'Northwind Trading' };
export const GOALS_PERSON = { email: 'goals@e2e.example', name: 'Robin Vale', password: 'goals-e2e-pass-1' };
const TEAMMATE = { email: 'goals-teammate@e2e.example', name: 'Sam Okafor' };
const DAY = 24 * 60 * 60 * 1000;

async function resetFixtures(): Promise<void> {
  const users = await db.select({ id: userSchema.id }).from(userSchema).where(inArray(userSchema.email, [GOALS_PERSON.email, TEAMMATE.email]));
  const accounts = await db.select({ id: tenantAccountSchema.id }).from(tenantAccountSchema).where(eq(tenantAccountSchema.slug, ACCOUNT.slug));
  const accountIds = accounts.map(a => a.id);
  const projects = accountIds.length > 0 ? await db.select({ id: projectSchema.id }).from(projectSchema).where(inArray(projectSchema.accountId, accountIds)) : [];
  const projectIds = projects.map(p => p.id);
  if (projectIds.length > 0) {
    await db.delete(goalSchema).where(inArray(goalSchema.orgId, projectIds));
    await db.delete(knowledgeDocumentSchema).where(inArray(knowledgeDocumentSchema.orgId, projectIds));
    await db.delete(knowledgeSourceSchema).where(inArray(knowledgeSourceSchema.orgId, projectIds));
    await db.delete(stateViewSchema).where(inArray(stateViewSchema.orgId, projectIds));
    await db.delete(artifactSchema).where(inArray(artifactSchema.orgId, projectIds));
    await db.delete(conversationSchema).where(inArray(conversationSchema.orgId, projectIds));
    await db.delete(projectSchema).where(inArray(projectSchema.id, projectIds));
  }
  if (users.length > 0) {
    await db.delete(accountMembershipSchema).where(inArray(accountMembershipSchema.userId, users.map(u => u.id)));
    await db.delete(userSchema).where(inArray(userSchema.id, users.map(u => u.id)));
  }
  if (accountIds.length > 0) {
    await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, accountIds));
  }
}

async function main(): Promise<void> {
  await resetFixtures();
  const tag = Date.now().toString(36);
  const accountId = `acct-e2e-goals-${tag}`;
  const robin = `usr-e2e-goals-robin-${tag}`;
  const sam = `usr-e2e-goals-sam-${tag}`;
  const gtm = `proj-e2e-goals-gtm-${tag}`;
  const partners = `proj-e2e-goals-partners-${tag}`;
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY);

  await db.insert(tenantAccountSchema).values({ id: accountId, name: ACCOUNT.name, slug: ACCOUNT.slug });
  await db.insert(userSchema).values([
    { id: robin, name: GOALS_PERSON.name, email: GOALS_PERSON.email, passwordHash: await hashPassword(GOALS_PERSON.password) },
    { id: sam, name: TEAMMATE.name, email: TEAMMATE.email },
  ]);
  await db.insert(accountMembershipSchema).values([{ accountId, userId: robin, role: 'admin' }, { accountId, userId: sam, role: 'member' }]);
  await db.insert(projectSchema).values([
    { id: gtm, accountId, slug: 'e2e-goals-gtm', name: 'GTM', createdAt: ago(60) },
    { id: partners, accountId, slug: 'e2e-goals-partners', name: 'Partners', createdAt: ago(50) },
  ]);

  // The expo list: 40 synced mail threads with partners met at the expo, 12 written back to.
  const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: gtm, slug: 'gmail', configJson: {} }).returning({ id: knowledgeSourceSchema.id });
  const people = ['Kestrel Capital', 'Contoso Supply', 'Larkfield Systems', 'Acme', 'Bellwater Hall'];
  await db.insert(knowledgeDocumentSchema).values(Array.from({ length: 40 }, (_, i) => ({
    orgId: gtm,
    sourceId: source!.id,
    externalId: `e2e-goals-thread-${i}`,
    title: `Northwind Expo follow-up · ${people[i % people.length]} (${i + 1})`,
    contentHash: `e2e-goals-${i}`,
    metadata: { kind: MAIL_THREAD_STATE_KIND, facets: { reply_state: i < 12 ? 'waiting_on_them' : 'needs_my_reply', category: 'partner', counterpart: `${people[i % people.length]} <contact${i}@northwind-expo.example>` } },
    lastModifiedAt: ago(i % 10),
  })));
  await db.insert(stateViewSchema).values({ scope: 'person', orgId: gtm, userId: robin, slug: 'northwind-expo-contacts', name: 'Northwind Expo contacts', description: 'Partner threads from the Northwind Expo.', query: { sets: ['mail.thread'], filter: { category: 'partner' } }, createdBy: robin });

  const [chat] = await db.insert(conversationSchema).values({ orgId: gtm, projectId: gtm, agentSlug: 'lead', title: 'Expo follow-up plan', createdBy: robin, createdAt: ago(9) }).returning({ id: conversationSchema.id });
  const [onePager] = await db.insert(artifactSchema).values({ orgId: partners, kind: 'markdown', title: 'Referral partner one-pager', spec: { markdown: '# Partner with Northwind' } } as never).returning({ id: artifactSchema.id });

  const set = (by: string, at: Date) => [{ at: at.toISOString(), what: 'Goal set', by }];
  await db.insert(goalSchema).values([
    {
      orgId: gtm,
      accountId,
      ownerUserId: robin,
      title: 'Follow up with Northwind Expo contacts',
      horizon: { kind: 'date', due: new Date(now + 52 * DAY).toISOString().slice(0, 10) },
      measure: { kind: 'view', view: 'northwind-expo-contacts', done: { reply_state: 'waiting_on_them' }, unit: 'contacted' },
      links: [{ kind: 'conversation', id: String(chat!.id), label: 'Expo follow-up plan' }, { kind: 'view', id: 'northwind-expo-contacts', label: 'Northwind Expo contacts' }],
      nextSteps: [
        { label: 'Draft notes to the next 5 contacts', prompt: 'For my goal "Follow up with Northwind Expo contacts": draft follow-up notes to the next 5 contacts I have not written to.' },
        { label: 'Who asked for pricing?', prompt: 'Which Northwind Expo contacts asked for pricing, and have I answered them?' },
      ],
      activity: [...set(robin, ago(9)), { at: ago(2).toISOString(), what: '12 of 40 contacted (+4)', by: 'measure' }],
      lastDone: 12,
      lastTotal: 40,
      progressAt: ago(2),
      createdBy: robin,
      createdFrom: chat!.id,
      createdAt: ago(9),
      updatedAt: ago(2),
    },
    {
      orgId: gtm,
      accountId,
      ownerUserId: robin,
      title: 'Expand vertical GTM strategy',
      horizon: { kind: 'quarter', quarter: `${new Date(now).getUTCFullYear()}-Q4` },
      cadence: 'weekly',
      measure: { kind: 'milestones', milestones: [
        { key: 'm1', label: 'Pick two verticals from the win data', done: true, by: robin, doneAt: ago(6).toISOString(), locked: true },
        { key: 'm2', label: 'Interview three customers in each', done: true, by: 'agent', doneAt: ago(3).toISOString(), evidence: 'CHAT-41: notes from six calls' },
        { key: 'm3', label: 'Write the vertical playbook', done: false },
        { key: 'm4', label: 'Launch the first campaign', done: false },
        { key: 'm5', label: 'Review the first month of pipeline', done: false },
      ] },
      activity: [...set(robin, ago(20)), { at: ago(6).toISOString(), what: 'Done: Pick two verticals from the win data', by: robin }, { at: ago(3).toISOString(), what: 'Done: Interview three customers in each', by: 'agent' }],
      lastDone: 2,
      lastTotal: 5,
      progressAt: ago(3),
      createdBy: robin,
      createdAt: ago(20),
      updatedAt: ago(3),
    },
    {
      orgId: gtm,
      accountId,
      ownerUserId: sam,
      title: 'Book the Bellwater Hall venue for the spring summit',
      horizon: { kind: 'date', due: new Date(now + 30 * DAY).toISOString().slice(0, 10) },
      measure: { kind: 'milestones', milestones: [{ key: 'm1', label: 'Shortlist dates', done: true }, { key: 'm2', label: 'Agree the budget', done: false }, { key: 'm3', label: 'Sign the contract', done: false }] },
      activity: set(sam, ago(5)),
      lastDone: 1,
      lastTotal: 3,
      progressAt: ago(4),
      createdBy: sam,
      createdAt: ago(5),
      updatedAt: ago(4),
    },
    {
      orgId: partners,
      accountId,
      ownerUserId: robin,
      title: 'Build referral partner collateral',
      horizon: { kind: 'date', due: new Date(now + 37 * DAY).toISOString().slice(0, 10) },
      measure: { kind: 'milestones', milestones: [
        { key: 'm1', label: 'Partner one-pager', done: true, by: 'agent', doneAt: ago(1).toISOString(), evidence: 'Linked artifact completed.', link: { kind: 'artifact', id: String(onePager!.id) } },
        { key: 'm2', label: 'Referral deck', done: false },
        { key: 'm3', label: 'Case study with Contoso Supply', done: false },
        { key: 'm4', label: 'Pricing sheet for partners', done: false },
      ] },
      links: [{ kind: 'artifact', id: String(onePager!.id), label: 'Referral partner one-pager' }],
      activity: [...set(robin, ago(8)), { at: ago(1).toISOString(), what: 'Done: Partner one-pager (linked artifact completed)', by: 'agent' }],
      lastDone: 1,
      lastTotal: 4,
      progressAt: ago(1),
      createdBy: robin,
      createdAt: ago(8),
      updatedAt: ago(1),
    },
    {
      orgId: partners,
      accountId,
      ownerUserId: robin,
      title: 'Activate referral partners',
      horizon: { kind: 'quarter', quarter: `${new Date(now).getUTCFullYear()}-Q4` },
      measure: { kind: 'milestones', milestones: [{ key: 'm1', label: 'Agree terms with the first three partners', done: false }, { key: 'm2', label: 'Brief them on the collateral', done: false }, { key: 'm3', label: 'First referred deal', done: false }] },
      activity: set(robin, ago(12)),
      lastDone: 0,
      lastTotal: 3,
      progressAt: null,
      createdBy: robin,
      createdAt: ago(12),
      updatedAt: ago(12),
    },
  ]);
  // Robin's Personal, as sign-in makes it, with one goal of its own.
  const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
  const personal = await ensurePersonalProject(robin, accountId);
  await db.insert(goalSchema).values({
    orgId: personal.id,
    accountId,
    ownerUserId: robin,
    title: 'Read two books on referral programs',
    horizon: { kind: 'date', due: new Date(now + 80 * DAY).toISOString().slice(0, 10) },
    measure: { kind: 'milestones', milestones: [{ key: 'm1', label: 'Pick the two', done: true }, { key: 'm2', label: 'Read the first', done: false }, { key: 'm3', label: 'Read the second', done: false }] },
    activity: set(robin, ago(4)),
    lastDone: 1,
    lastTotal: 3,
    progressAt: ago(4),
    createdBy: robin,
    createdAt: ago(4),
    updatedAt: ago(4),
  });
  process.stdout.write(`${JSON.stringify({ accountId, robin, gtm, partners, personalSlug: personal.slug })}\n`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
