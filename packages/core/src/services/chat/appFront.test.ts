/**
 * The app fronts end to end on the PGlite mock: the shipped app catalogue
 * decides which apps a workspace has, each app's teams come from its
 * plugins' teams and a workspace team's `app:`, and each app leads with its
 * own teams' newest brief, never the newest in the workspace.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listApps } from '@/libs/workspace/apps';
import { loadPlugin, pluginContents } from '@/libs/workspace/plugins';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { agentSchema, automationRunSchema, briefingSchema, projectSchema, teamSchema, tenantAccountSchema } = await import('@/models/Schema');
const { loadAppFronts } = await import('./appFront');

const ORG = 'proj_app_front';
const NOW = new Date('2026-10-29T17:00:00Z');

// Two shipped apps, each with a plugin that ships a team: read from the
// manifests, so the test names no app.
const apps = listApps().filter(a => !a.core && !a.hidden);
const withTeam = apps
  .map(app => ({ app, plugin: app.plugins.find(p => pluginContents(loadPlugin(p)).teams.length > 0) }))
  .filter((x): x is { app: typeof apps[number]; plugin: string } => Boolean(x.plugin));
const [first, second] = withTeam;
const teamOf = (plugin: string) => pluginContents(loadPlugin(plugin)).teams[0]!;

async function cleanDb() {
  for (const table of [briefingSchema, automationRunSchema, teamSchema, agentSchema, projectSchema, tenantAccountSchema]) {
    await db.delete(table);
  }
}

beforeEach(async () => {
  await cleanDb();
  await db.insert(tenantAccountSchema).values({ id: 'acct-front', name: 'Northwind', slug: 'northwind-front' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-front', slug: 'front', name: 'Front', enabledPlugins: [first!.plugin, second!.plugin], timeZone: 'America/Los_Angeles' });
  await db.insert(teamSchema).values([
    { orgId: ORG, slug: teamOf(first!.plugin), name: 'First', leadAgentSlug: 'first-lead' },
    { orgId: ORG, slug: teamOf(second!.plugin), name: 'Second', leadAgentSlug: 'second-lead' },
    // The workspace's own team, joined to the first app by its file.
    { orgId: ORG, slug: 'pipeline', name: 'Pipeline', leadAgentSlug: 'pipeline-lead', app: first!.app.id },
    // A workspace team that names no app stays with the core app.
    { orgId: ORG, slug: 'back-office', name: 'Back office', leadAgentSlug: 'office-lead' },
  ]);
});

afterAll(cleanDb);

describe('loadAppFronts', () => {
  it('needs two shipped apps whose plugins ship teams', () => {
    expect(withTeam.length).toBeGreaterThanOrEqual(2);
  });

  it('leads each app with its own teams\' newest brief, never the newest in the workspace', async () => {
    await db.insert(briefingSchema).values([
      // The newest brief in the workspace is the second app's…
      { orgId: ORG, title: 'Second update', content: '-', teamSlug: teamOf(second!.plugin), createdAt: new Date('2026-10-29T16:00:00Z') },
      // …the first app's own is yesterday's, from its workspace team…
      { orgId: ORG, title: 'Pipeline Briefing', content: '-', teamSlug: 'pipeline', createdAt: new Date('2026-10-28T14:00:00Z') },
      // …and neither the rollup nor a core-app team's brief belongs to an app.
      { orgId: ORG, title: 'Rollup', content: '-', teamSlug: null, createdAt: new Date('2026-10-29T16:30:00Z') },
      { orgId: ORG, title: 'Back office', content: '-', teamSlug: 'back-office', createdAt: new Date('2026-10-29T16:40:00Z') },
    ]);
    const fronts = await loadAppFronts(ORG, NOW);

    expect(fronts[first!.app.id]?.briefing).toMatchObject({ title: 'Pipeline Briefing', today: false, dateLabel: 'Wed, Oct 28', failedRun: null });
    expect(fronts[first!.app.id]?.leadSlug).toBe('pipeline-lead');
    expect(fronts[first!.app.id]?.prompt).toContain('the Wed, Oct 28 briefing ("Pipeline Briefing")');
    expect(fronts[second!.app.id]?.briefing).toMatchObject({ title: 'Second update', today: true });
    expect(fronts[second!.app.id]?.leadSlug).toBe('second-lead');
  });

  it('says a stale brief\'s run failed, with the run', async () => {
    const published = new Date('2026-10-28T14:03:00Z');
    await db.insert(briefingSchema).values({ orgId: ORG, title: 'Pipeline Briefing', content: '-', teamSlug: 'pipeline', createdAt: published });
    await db.insert(automationRunSchema).values([
      { orgId: ORG, slug: 'morning-brief', kind: 'mission_check', status: 'ok', targetRunId: 41, startedAt: new Date('2026-10-28T14:00:00Z'), finishedAt: new Date('2026-10-28T14:05:00Z') },
      { orgId: ORG, slug: 'morning-brief', kind: 'mission_check', status: 'error', targetRunId: 42, startedAt: new Date('2026-10-29T12:00:00Z'), finishedAt: new Date('2026-10-29T12:01:00Z') },
    ]);
    const fronts = await loadAppFronts(ORG, NOW);

    expect(fronts[first!.app.id]?.briefing?.failedRun).toEqual({ href: '/dashboard/missions/runs/42' });
  });

  it('has no front for an app with nothing to say', async () => {
    expect(await loadAppFronts(ORG, NOW)).toEqual({});
  });
});
