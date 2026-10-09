import process from 'node:process';
import { parseArgs } from 'node:util';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accountMembershipSchema, agentSchema, apiTokenSchema, knowledgeSourceSchema, projectSchema, sourceSyncCheckpointSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Test-support for the `connections` spec, and for screenshots of the
 * Connectors page. Two jobs, both keyed by the admin's email so a database
 * that holds several specs' Orgs is never touched outside this one:
 *
 *   --mode fixtures   Put three connections in the Org's shared workspace, one
 *                     in each state the page words: Working (a crawl synced two
 *                     hours ago, read by an agent), Needs attention (Jira, never
 *                     signed in) and Paused (HubSpot) — and turn on an app
 *                     that needs GitHub, so one recommendation shows. Idempotent.
 *   --mode revoke     Revoke the workspace's live credentials for one platform
 *                     (`--platform apollo`), the way the app itself revokes —
 *                     so the next load reads "access was revoked".
 *
 * Fictional throughout (Northwind). Run through `dotenv -c`:
 *
 *   npx dotenv -c -- npx tsx e2e/connections/support/fixtures.ts \
 *     --email connections-e2e@northwind.example --mode fixtures
 */

/**
 * The shared workspace the person's Org was created with.
 * @param email - The admin's email.
 */
async function workspaceOf(email: string): Promise<string> {
  const [user] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (!user) {
    throw new Error(`no user ${email}`);
  }
  const [membership] = await db.select({ accountId: accountMembershipSchema.accountId }).from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, user.id)).limit(1);
  if (!membership) {
    throw new Error(`${email} belongs to no Org`);
  }
  const [project] = await db
    .select({ id: projectSchema.id })
    .from(projectSchema)
    .where(and(eq(projectSchema.accountId, membership.accountId), ne(projectSchema.kind, 'personal')))
    .limit(1);
  if (!project) {
    throw new Error(`${email}'s Org has no shared workspace`);
  }
  return project.id;
}

/**
 * Insert one source unless the workspace already has it.
 * @param orgId - The workspace.
 * @param slug - The source's slug.
 * @param connector - Its connector.
 * @param config - Its config.
 * @param enabled - 'true', or 'false' for paused.
 */
async function ensureFixtureSource(orgId: string, slug: string, connector: string, config: Record<string, unknown>, enabled: 'true' | 'false'): Promise<number> {
  const [existing] = await db.select({ id: knowledgeSourceSchema.id }).from(knowledgeSourceSchema).where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, slug))).limit(1);
  if (existing) {
    return existing.id;
  }
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId, projectId: orgId, slug, kind: 'plugin', configJson: { ...config, _connector: connector }, enabled })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedFixtures(orgId: string): Promise<void> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const web = await ensureFixtureSource(orgId, 'northwind-docs', 'web', { crawl: { startUrl: 'https://docs.northwind.example', maxPages: 50 } }, 'true');
  await db.update(knowledgeSourceSchema).set({ lastSyncedAt: twoHoursAgo }).where(eq(knowledgeSourceSchema.id, web));
  const [checkpoint] = await db.select({ id: sourceSyncCheckpointSchema.id }).from(sourceSyncCheckpointSchema).where(eq(sourceSyncCheckpointSchema.sourceId, web)).limit(1);
  if (!checkpoint) {
    await db.insert(sourceSyncCheckpointSchema).values({ orgId, sourceId: web, status: 'completed', startedAt: twoHoursAgo, completedAt: twoHoursAgo, counts: { created: 42 } });
  }
  await ensureFixtureSource(orgId, 'jira', 'jira', { siteUrl: 'https://northwind.example', projects: ['OPS'] }, 'true');
  await ensureFixtureSource(orgId, 'hubspot', 'hubspot', { objectType: 'contacts' }, 'false');

  const [agent] = await db.select({ id: agentSchema.id }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, 'support-lead'))).limit(1);
  if (!agent) {
    await db.insert(agentSchema).values({ orgId, slug: 'support-lead', name: 'Support lead', systemPrompt: 'Answer from the Northwind docs.', connectorSources: ['northwind-docs'] });
  }
  // An app that needs GitHub, so the page has a recommendation with a reason.
  const [project] = await db.select({ enabledPlugins: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const plugins = project?.enabledPlugins ?? [];
  if (!plugins.includes('software-factory')) {
    await db.update(projectSchema).set({ enabledPlugins: [...plugins, 'software-factory'] }).where(eq(projectSchema.id, orgId));
  }
  console.warn(`[connections fixtures] seeded workspace ${orgId}`);
}

async function revoke(orgId: string, platform: string): Promise<void> {
  const revoked = await db
    .update(apiTokenSchema)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokenSchema.orgId, orgId), eq(apiTokenSchema.platform, platform), isNull(apiTokenSchema.revokedAt)))
    .returning({ id: apiTokenSchema.id });
  console.warn(`[connections fixtures] revoked ${revoked.length} live ${platform} credential(s)`);
}

const { values } = parseArgs({ options: { email: { type: 'string' }, mode: { type: 'string' }, platform: { type: 'string' } } });

async function main(): Promise<void> {
  if (!values.email || (values.mode !== 'fixtures' && values.mode !== 'revoke') || (values.mode === 'revoke' && !values.platform)) {
    throw new Error('usage: --email <admin> --mode fixtures | --mode revoke --platform <id>');
  }
  const orgId = await workspaceOf(values.email);
  if (values.mode === 'fixtures') {
    await seedFixtures(orgId);
  } else {
    await revoke(orgId, values.platform!);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(`[connections fixtures] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
