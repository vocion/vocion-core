#!/usr/bin/env tsx
import process from 'node:process';
/**
 * seed-seo-home. Two workspaces for the app home spec (`app-home.spec.ts`):
 *
 * - `--email`: the SEO app on, its team and two of its seats, one client
 *   project (Northwind Outfitters) with a strategy, two pages live this
 *   month, an audit, keywords and AI prompts, one go-live decision waiting
 *   outside any chat, and a brief the strategist wrote.
 * - `--empty-email`: the SEO app on and nothing else, for the empty home.
 *
 * Straight into the database, the way the `needs-you` seed files its asks.
 * Idempotent: a rerun clears what it made first. Fictional throughout
 * (`libs/fixtures/realDataGuard.ts`). Prints one JSON line; everything else
 * goes to stderr.
 *
 * Usage:
 *   npx dotenv -c -- npx tsx e2e/app-home/support/seed-seo-home.ts --email a@b.test --empty-email c@d.test
 */
import { parseArgs } from 'node:util';
import { and, eq, inArray, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, artifactSchema, askSchema, businessObjectSchema, businessObjectTypeSchema, goalSchema, projectSchema, teamSchema, userSchema } from '@/models/Schema';
import { createGoal } from '@/services/objectives/GoalService';

const SOURCE = 'e2e-app-home:';
const TYPES = ['data_room', 'seo_strategy', 'seo_page', 'seo_audit', 'seo_keyword', 'seo_prompt'] as const;

const { values } = parseArgs({ options: { 'email': { type: 'string' }, 'empty-email': { type: 'string' } } });

async function workspaceOf(email: string): Promise<{ id: string; plugins: string[] }> {
  const [row] = await db
    .select({ id: projectSchema.id, plugins: projectSchema.enabledPlugins })
    .from(userSchema)
    .innerJoin(accountMembershipSchema, eq(accountMembershipSchema.userId, userSchema.id))
    .innerJoin(projectSchema, eq(projectSchema.accountId, accountMembershipSchema.accountId))
    .where(eq(userSchema.email, email))
    .limit(1);
  if (!row) {
    throw new Error(`no workspace for ${email}: seed the user first`);
  }
  return { id: row.id, plugins: row.plugins ?? [] };
}

async function turnOnSeo(ws: { id: string; plugins: string[] }): Promise<void> {
  const plugins = [...new Set([...ws.plugins, 'seo', 'data-rooms', 'wiki'])];
  await db.update(projectSchema).set({ enabledPlugins: plugins }).where(eq(projectSchema.id, ws.id));
}

async function typeIds(orgId: string): Promise<Record<string, number>> {
  await db.insert(businessObjectTypeSchema).values(TYPES.map(slug => ({ orgId, slug, label: slug }))).onConflictDoNothing();
  const rows = await db.select({ id: businessObjectTypeSchema.id, slug: businessObjectTypeSchema.slug }).from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), inArray(businessObjectTypeSchema.slug, [...TYPES])));
  return Object.fromEntries(rows.map(r => [r.slug, r.id]));
}

async function seedBusy(email: string): Promise<{ orgId: string; projectId: number }> {
  const ws = await workspaceOf(email);
  const orgId = ws.id;
  await turnOnSeo(ws);
  await db.insert(teamSchema).values({ orgId, slug: 'seo', name: 'SEO', leadAgentSlug: 'seo-strategist' }).onConflictDoNothing();
  await db.insert(agentSchema).values([
    { orgId, slug: 'seo-strategist', name: 'SEO Strategist', systemPrompt: 'Plans and briefs SEO pages.', teamSlug: 'seo' },
    { orgId, slug: 'seo-editor', name: 'SEO Editor', systemPrompt: 'Checks every draft.', teamSlug: 'seo' },
  ]).onConflictDoNothing();

  const types = await typeIds(orgId);
  // Clear what an earlier run made.
  await db.delete(goalSchema).where(and(eq(goalSchema.orgId, orgId), eq(goalSchema.title, 'E2E Northwind delivery plan')));
  await db.delete(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), like(businessObjectSchema.title, 'E2E %')));
  await db.delete(askSchema).where(and(eq(askSchema.orgId, orgId), like(askSchema.sourceRef, `${SOURCE}%`)));
  await db.delete(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), like(artifactSchema.title, 'E2E %')));

  const now = new Date();
  const iso = now.toISOString();
  const [project] = await db.insert(businessObjectSchema).values({
    orgId,
    typeId: types.data_room!,
    title: 'E2E Northwind Outfitters',
    metadata: { seoProfile: { clientType: 'ecommerce', goals: ['organic_leads'] }, seoCadence: { pagesPerMonth: 8 } },
  }).returning({ id: businessObjectSchema.id });
  const projectId = project!.id;
  const rec = (type: string, title: string, meta: Record<string, unknown>) => ({ orgId, typeId: types[type]!, title: `E2E ${title}`, metadata: { projectId, projectName: 'Northwind Outfitters', ...meta } });
  await db.insert(businessObjectSchema).values([
    rec('seo_strategy', 'Northwind strategy', { goalTitle: 'Northwind ranks for trail running gear by Q1', progressLine: '2 of 5 milestones done', goalStatus: 'active', updatedAt: iso }),
    rec('seo_page', 'Trail running shoes', { keyword: 'trail running shoes', status: 'published', publishedAt: iso }),
    rec('seo_page', 'Waterproof hiking boots', { keyword: 'waterproof hiking boots', status: 'published', publishedAt: iso }),
    rec('seo_page', 'Ultralight tents', { keyword: 'ultralight tents', status: 'drafting' }),
    rec('seo_audit', 'Audit of northwind.example', { site: 'https://northwind.example', openCount: 6, highCount: 1, checkedAt: iso, counts: { bySeverity: { high: 1, medium: 3, low: 2 } } }),
    rec('seo_keyword', 'trail shoes', { keyword: 'trail shoes', status: 'ranking', checkedAt: iso }),
    rec('seo_keyword', 'hiking socks', { keyword: 'hiking socks', status: 'idea', checkedAt: iso }),
    rec('seo_prompt', 'best trail shoes for beginners', { prompt: 'best trail shoes for beginners', visibility: 'mentioned', checkedAt: iso }),
    rec('seo_prompt', 'alternatives to big outdoor retailers', { prompt: 'alternatives to big outdoor retailers', visibility: 'absent', checkedAt: iso }),
  ]);

  const [owner] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email));
  const goal = await createGoal({ orgId, ownerUserId: owner!.id, title: 'E2E Northwind delivery plan', horizon: { kind: 'quarter', quarter: '2027-Q1' }, measure: { kind: 'milestones', milestones: ['Verify audit coverage', 'Publish service pages', 'Measure search outcomes'].map((label, i) => ({ key: `m${i}`, label, done: false })) }, links: [{ kind: 'room', id: String(projectId), label: 'Northwind Outfitters' }], cadence: 'weekly', createdBy: owner!.id });
  await db.update(businessObjectSchema).set({ externalSystem: 'seo-strategy', externalId: String(projectId), metadata: { projectId, projectName: 'Northwind Outfitters', goalId: goal.id, goalTitle: 'Northwind ranks for trail running gear by Q1', progressLine: '2 of 5 milestones done', goalStatus: 'active', horizon: 'Q1 2027', milestones: [], updatedAt: iso, roadmap: { revision: 0, initiatives: [], outcomes: [] } } }).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.title, 'E2E Northwind strategy')));

  await db.insert(askSchema).values({
    orgId,
    kind: 'ruling',
    title: 'Go live with the Trail shoes pages?',
    body: 'Both pages passed the editor and you signed them off.',
    sourceRef: `${SOURCE}go-live`,
    agentSlug: 'seo-strategist',
    options: [
      { id: 'live', label: 'Go live', recommended: true },
      { id: 'wait', label: 'Not yet' },
    ],
  });
  await db.insert(artifactSchema).values({ orgId, kind: 'markdown', title: 'E2E Trail shoes brief', lastAuthorKind: 'agent', lastAuthorId: 'seo-strategist' });
  return { orgId, projectId };
}

async function seedEmpty(email: string): Promise<{ orgId: string }> {
  const ws = await workspaceOf(email);
  await turnOnSeo(ws);
  return { orgId: ws.id };
}

async function main(): Promise<void> {
  if (!values.email || !values['empty-email']) {
    console.error('pass --email <the busy admin> --empty-email <the empty admin>');
    process.exit(1);
  }
  const busy = await seedBusy(values.email);
  const empty = await seedEmpty(values['empty-email']);
  process.stdout.write(`${JSON.stringify({ busy, empty })}\n`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
