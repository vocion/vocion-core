/**
 * The team-report authoring surface: `goal:` on the workspace manifest and
 * `goal:` / `kpis:` on a team manifest — what parses, what is refused, and
 * how it round-trips through the export mapping.
 */
import { describe, expect, it } from 'vitest';
import { TeamKpiSchema, TeamManifestSchema, WorkspaceManifestSchema } from './schemas';
import { projectLeadToManifestKeys, teamRowToManifest } from './team-export';

describe('team kpis + goal (manifest)', () => {
  it('parses a team with a goal and KPIs, defaulting window to all', () => {
    const t = TeamManifestSchema.parse({
      name: 'Engineering',
      goal: 'Merged-quality PRs.',
      kpis: [
        { key: 'prs_merged', label: 'Merged PRs', target: 4, unit: 'PRs', source: 'counts.prs_merged' },
        { key: 'prs_today', label: 'Opened today', target: 2, source: 'counts.prs_opened', window: '24h' },
      ],
    });

    expect(t.goal).toBe('Merged-quality PRs.');
    expect(t.kpis[0]!.window).toBe('all');
    expect(t.kpis[1]!.window).toBe('24h');
  });

  it('a team without kpis parses to an empty list (byte-for-byte compatible with F1 teams)', () => {
    expect(TeamManifestSchema.parse({ name: 'RevOps' }).kpis).toEqual([]);
  });

  it('refuses a source that is not counts.<key>, and duplicate kpi keys', () => {
    expect(() => TeamKpiSchema.parse({ key: 'k', label: 'K', target: 1, source: 'tokens' })).toThrow(/counts\.<key>/);
    expect(() => TeamManifestSchema.parse({
      name: 'X',
      kpis: [
        { key: 'k', label: 'K', target: 1, source: 'counts.a' },
        { key: 'k', label: 'K2', target: 1, source: 'counts.b' },
      ],
    })).toThrow(/unique/);
    expect(() => TeamKpiSchema.parse({ key: 'k', label: 'K', target: 0, source: 'counts.a' })).toThrow();
  });

  it('takes an optional baseline that must sit below the target', () => {
    expect(TeamKpiSchema.parse({ key: 'k', label: 'K', target: 10, baseline: 3, source: 'counts.a' }).baseline).toBe(3);
    expect(() => TeamKpiSchema.parse({ key: 'k', label: 'K', target: 10, baseline: 10, source: 'counts.a' })).toThrow(/below target/);
  });

  it('workspace.yaml takes an optional top-line goal', () => {
    const base = { version: 1, orgId: 'proj_x', name: 'X' };

    expect(WorkspaceManifestSchema.parse(base).goal).toBeUndefined();
    expect(WorkspaceManifestSchema.parse({ ...base, goal: 'Be found first.' }).goal).toBe('Be found first.');
    expect(() => WorkspaceManifestSchema.parse({ ...base, goal: '' })).toThrow();
  });

  it('exports goal + kpis when set and omits both keys when not, so F1 files round-trip unchanged', () => {
    const emails = new Map<string, string>();
    const bare = teamRowToManifest({ slug: 'a', name: 'A', description: null, leadAgentSlug: null, accountableUserId: null, goal: null, kpis: [] }, emails);

    expect(bare).toEqual({ name: 'A' });

    const full = teamRowToManifest({ slug: 'a', name: 'A', description: null, leadAgentSlug: 'x', accountableUserId: null, goal: 'G', kpis: [{ key: 'k', label: 'K', target: 3, source: 'counts.k' }] }, emails);

    expect(full).toEqual({ name: 'A', lead: 'x', goal: 'G', kpis: [{ key: 'k', label: 'K', target: 3, source: 'counts.k', window: 'all' }] });
    expect(TeamManifestSchema.parse(full)).toEqual(full);

    expect(projectLeadToManifestKeys({ leadAgentSlug: 'ceo', accountableUserId: null, goal: 'Top' }, emails)).toEqual({ lead: 'ceo', goal: 'Top' });
    expect(projectLeadToManifestKeys({ leadAgentSlug: null, accountableUserId: null }, emails)).toEqual({});
  });
});
