/**
 * The team-report authoring surface: `goal:` on the workspace manifest and
 * `goal:` / `measures:` on a team manifest (with `kpis:` as the one-release
 * alias) — what parses, what is refused, and how it round-trips through the
 * export mapping. Spec: docs/specs/team-report-v2.md §1–§3.
 */
import { describe, expect, it } from 'vitest';
import { kpiToMeasure, TeamKpiSchema, TeamManifestSchema, TeamMeasureSchema, WorkspaceManifestSchema } from './schemas';
import { effectiveMeasures, measureToManifest, projectLeadToManifestKeys, teamRowToManifest } from './team-export';

describe('team measures (manifest)', () => {
  it('parses a measure with every provenance kind, defaulting dimension, window and direction', () => {
    const verified = TeamMeasureSchema.parse({
      key: 'pipeline_created',
      label: 'Qualified pipeline created',
      target: 400_000,
      unit: '$',
      source: { kind: 'verified', connector: 'hubspot', query: { object: 'deals', filter: { dealStages: ['Qualified'] }, aggregate: 'sum(amount)' } },
    });

    expect(verified).toMatchObject({ dimension: 'outcome', window: '7d', direction: 'higher' });
    expect(verified.source).toMatchObject({ kind: 'verified', query: { aggregate: 'sum(amount)' } });

    expect(TeamMeasureSchema.parse({ key: 'sent', label: 'Emails sent', target: 10, source: { kind: 'observed', actions: ['gmail.send'] } }).source.kind).toBe('observed');
    expect(TeamMeasureSchema.parse({ key: 'runs', label: 'Runs with drafts', target: 10, source: { kind: 'observed', counts: 'drafts' } }).source.kind).toBe('observed');
    expect(TeamMeasureSchema.parse({ key: 'approved', label: 'Approved proposals', target: 10, source: { kind: 'human-confirmed', actions: ['hubspot.update'] } }).source.kind).toBe('human-confirmed');
    expect(TeamMeasureSchema.parse({ key: 'rulings', label: 'Rulings answered', target: 3, source: { kind: 'human-confirmed', askKinds: ['ruling'] } }).source.kind).toBe('human-confirmed');
    expect(TeamMeasureSchema.parse({ key: 'pitches', label: 'Pitches', target: 12, source: { kind: 'agent-reported', counts: 'pitches' } }).source.kind).toBe('agent-reported');
  });

  it('a lower-is-better measure takes a baseline above its target; a higher one below', () => {
    expect(TeamMeasureSchema.parse({ key: 'turnaround', label: 'Turnaround', dimension: 'velocity', target: 30, baseline: 240, unit: 'min', direction: 'lower', source: { kind: 'agent-reported', counts: 'turnaround_min' } }).baseline).toBe(240);
    expect(() => TeamMeasureSchema.parse({ key: 'turnaround', label: 'T', target: 30, baseline: 10, direction: 'lower', source: { kind: 'agent-reported', counts: 'x' } })).toThrow(/far side/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 10, baseline: 10, source: { kind: 'agent-reported', counts: 'x' } })).toThrow(/far side/);
  });

  it('refuses a malformed source', () => {
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'observed' } })).toThrow(/either actions or a counts key/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'observed', actions: ['a'], counts: 'b' } })).toThrow(/either actions or a counts key/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'human-confirmed' } })).toThrow(/actions or askKinds/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'verified', connector: 'salesforce', query: { object: 'deals' } } })).toThrow();
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'verified', connector: 'hubspot', query: { object: 'deals', aggregate: 'sum(revenue)' } } })).toThrow(/count or sum\(amount\)/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'agent-reported', counts: 'counts.pitches' } })).toThrow(/plain key/);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 0, source: { kind: 'agent-reported', counts: 'x' } })).toThrow();
  });

  it('a workspace-goal contribution needs a weight', () => {
    expect(TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'agent-reported', counts: 'x' }, contributesTo: 'workspace-goal', weight: 0.3 }).weight).toBe(0.3);
    expect(() => TeamMeasureSchema.parse({ key: 'k', label: 'K', target: 1, source: { kind: 'agent-reported', counts: 'x' }, contributesTo: 'workspace-goal' })).toThrow(/needs a weight/);
  });

  it('a team parses measures and folds a legacy kpis: block in as agent-reported measures', () => {
    const t = TeamManifestSchema.parse({
      name: 'Engineering',
      goal: 'Merged-quality PRs.',
      measures: [{ key: 'prs_merged', label: 'Merged PRs', target: 4, unit: 'PRs', source: { kind: 'human-confirmed', actions: ['github.merge'] } }],
      kpis: [{ key: 'prs_today', label: 'Opened today', target: 2, source: 'counts.prs_opened', window: '24h' }],
    });

    expect(t.goal).toBe('Merged-quality PRs.');
    expect(t).not.toHaveProperty('kpis');
    expect(t.measures.map(m => m.key)).toEqual(['prs_merged', 'prs_today']);
    expect(t.measures[1]).toEqual({ key: 'prs_today', label: 'Opened today', dimension: 'outcome', target: 2, window: '24h', direction: 'higher', source: { kind: 'agent-reported', counts: 'prs_opened' } });
  });

  it('kpiToMeasure maps the all-time window to quarter, the longest measure window', () => {
    expect(kpiToMeasure(TeamKpiSchema.parse({ key: 'k', label: 'K', target: 3, baseline: 1, unit: 'PRs', source: 'counts.k' }))).toEqual({
      key: 'k',
      label: 'K',
      dimension: 'outcome',
      target: 3,
      baseline: 1,
      unit: 'PRs',
      window: 'quarter',
      direction: 'higher',
      source: { kind: 'agent-reported', counts: 'k' },
    });
  });

  it('a team without measures parses to an empty list (byte-for-byte compatible with F1 teams)', () => {
    expect(TeamManifestSchema.parse({ name: 'RevOps' }).measures).toEqual([]);
  });

  it('refuses duplicate keys across measures and the kpis alias, and a legacy source that is not counts.<key>', () => {
    expect(() => TeamKpiSchema.parse({ key: 'k', label: 'K', target: 1, source: 'tokens' })).toThrow(/counts\.<key>/);
    expect(() => TeamManifestSchema.parse({
      name: 'X',
      measures: [{ key: 'k', label: 'K', target: 1, source: { kind: 'agent-reported', counts: 'a' } }],
      kpis: [{ key: 'k', label: 'K2', target: 1, source: 'counts.b' }],
    })).toThrow(/unique/);
  });

  it('workspace.yaml takes an optional top-line goal', () => {
    const base = { version: 1, orgId: 'proj_x', name: 'X' };

    expect(WorkspaceManifestSchema.parse(base).goal).toBeUndefined();
    expect(WorkspaceManifestSchema.parse({ ...base, goal: 'Be found first.' }).goal).toBe('Be found first.');
    expect(() => WorkspaceManifestSchema.parse({ ...base, goal: '' })).toThrow();
  });
});

describe('team export round-trip', () => {
  const emails = new Map<string, string>();

  it('exports goal + measures when set and omits both keys when not, so F1 files round-trip unchanged', () => {
    const bare = teamRowToManifest({ slug: 'a', name: 'A', description: null, leadAgentSlug: null, accountableUserId: null, goal: null, measures: [] }, emails);

    expect(bare).toEqual({ name: 'A' });

    const measure = { key: 'k', label: 'K', dimension: 'outcome' as const, target: 3, window: '7d' as const, direction: 'higher' as const, source: { kind: 'human-confirmed' as const, actions: ['github.merge'] } };
    const full = teamRowToManifest({ slug: 'a', name: 'A', description: null, leadAgentSlug: 'x', accountableUserId: null, goal: 'G', measures: [measure] }, emails);

    // Defaults are dropped on export and restored on parse.
    expect(full).toEqual({ name: 'A', lead: 'x', goal: 'G', measures: [{ key: 'k', label: 'K', target: 3, source: { kind: 'human-confirmed', actions: ['github.merge'] } }] });
    expect(TeamManifestSchema.parse(full).measures).toEqual([measure]);

    expect(projectLeadToManifestKeys({ leadAgentSlug: 'ceo', accountableUserId: null, goal: 'Top' }, emails)).toEqual({ lead: 'ceo', goal: 'Top' });
    expect(projectLeadToManifestKeys({ leadAgentSlug: null, accountableUserId: null }, emails)).toEqual({});
  });

  it('a row applied before measures existed exports its kpis as measures — the alias is read, never written', () => {
    const row = { slug: 'a', name: 'A', description: null, leadAgentSlug: null, accountableUserId: null, goal: null, kpis: [{ key: 'k', label: 'K', target: 3, source: 'counts.k' }], measures: [] };

    expect(effectiveMeasures(row)).toEqual([{ key: 'k', label: 'K', dimension: 'outcome', target: 3, window: 'quarter', direction: 'higher', source: { kind: 'agent-reported', counts: 'k' } }]);
    expect(teamRowToManifest(row, emails)).toEqual({ name: 'A', measures: [{ key: 'k', label: 'K', target: 3, window: 'quarter', source: { kind: 'agent-reported', counts: 'k' } }] });
  });

  it('measureToManifest keeps every non-default field', () => {
    expect(measureToManifest({ key: 'k', label: 'K', dimension: 'velocity', target: 30, baseline: 240, unit: 'min', window: '30d', direction: 'lower', source: { kind: 'agent-reported', counts: 't' }, contributesTo: 'workspace-goal', weight: 0.2 }))
      .toEqual({ key: 'k', label: 'K', dimension: 'velocity', target: 30, baseline: 240, unit: 'min', window: '30d', direction: 'lower', source: { kind: 'agent-reported', counts: 't' }, contributesTo: 'workspace-goal', weight: 0.2 });
  });
});
