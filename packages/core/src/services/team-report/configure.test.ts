/**
 * Configure workforce — the guided form as a plan of YAML edits through the
 * workspace-as-code path. Spec: docs/specs/team-report-v2.md §10–§11.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { TeamManifestSchema } from '@/libs/workspace/schemas';
import { keyFromLabel, planWorkforceConfig } from './configure';

describe('planWorkforceConfig', () => {
  it('writes goal into workspace.yaml after the identity keys and mission + primary measure into teams/<slug>.yaml, preserving what was there', () => {
    const files = planWorkforceConfig(
      {
        goal: 'Create $1.5M of qualified pipeline this quarter.',
        teams: [{
          slug: 'founder-gtm',
          mission: 'Turn the founder network into qualified introductions.',
          measure: { label: 'Qualified referrals', target: 10, unit: 'referrals', source: { kind: 'human-confirmed', actions: ['gmail.send'] } },
        }],
      },
      {
        workspaceYaml: 'version: 1\norgId: proj_x\nname: Revenue\nsurfaces:\n  - gtm\n',
        teamYaml: new Map([['founder-gtm', 'name: Founder GTM\nlead: gtm-lead\ndescription: Founder-led outreach.\n']]),
      },
    );

    expect(files.map(f => f.path)).toEqual(['workspace.yaml', 'teams/founder-gtm.yaml']);

    const ws = parseYaml(files[0]!.after);

    expect(Object.keys(ws)).toEqual(['version', 'orgId', 'name', 'goal', 'surfaces']);
    expect(ws.goal).toBe('Create $1.5M of qualified pipeline this quarter.');
    expect(files[0]!.unchanged).toBe(false);

    const team = parseYaml(files[1]!.after);

    expect(team).toEqual({
      name: 'Founder GTM',
      lead: 'gtm-lead',
      description: 'Founder-led outreach.',
      goal: 'Turn the founder network into qualified introductions.',
      measures: [{ key: 'qualified_referrals', label: 'Qualified referrals', target: 10, unit: 'referrals', source: { kind: 'human-confirmed', actions: ['gmail.send'] } }],
    });
    // What it wrote is what the loader accepts.
    expect(TeamManifestSchema.parse(team).measures[0]!.key).toBe('qualified_referrals');
  });

  it('replaces a measure with the same key, keeps the others, and retires a legacy kpi of that key', () => {
    const [file] = planWorkforceConfig(
      { teams: [{ slug: 'eng', measure: { label: 'Merged PRs', key: 'prs_merged', target: 8, window: '30d', source: { kind: 'human-confirmed', actions: ['github.merge'] } } }] },
      { workspaceYaml: null, teamYaml: new Map([['eng', 'name: Engineering\nmeasures:\n  - key: prs_merged\n    label: Old\n    target: 4\n    source:\n      kind: agent-reported\n      counts: prs_merged\n  - key: other\n    label: Other\n    target: 1\n    source:\n      kind: agent-reported\n      counts: other\nkpis:\n  - key: prs_merged\n    label: Legacy\n    target: 1\n    source: counts.prs_merged\n']]) },
    );
    const team = parseYaml(file!.after);

    expect(team.measures.map((m: { key: string }) => m.key)).toEqual(['prs_merged', 'other']);
    expect(team.measures[0]).toEqual({ key: 'prs_merged', label: 'Merged PRs', target: 8, window: '30d', source: { kind: 'human-confirmed', actions: ['github.merge'] } });
    expect(team.kpis).toBeUndefined();
  });

  it('creates a team file that did not exist, named after the slug; a no-op plan is marked unchanged', () => {
    const [created] = planWorkforceConfig({ teams: [{ slug: 'new-team', mission: 'Do the thing.' }] }, { workspaceYaml: null, teamYaml: new Map() });

    expect(created!.before).toBeNull();
    expect(parseYaml(created!.after)).toEqual({ goal: 'Do the thing.', name: 'new-team' });

    const same = 'name: X\n';
    const [unchanged] = planWorkforceConfig({ teams: [{ slug: 'x' }] }, { workspaceYaml: null, teamYaml: new Map([['x', same]]) });

    expect(unchanged!.unchanged).toBe(true);
  });

  it('refuses an invalid measure or slug before anything would be written', () => {
    expect(() => planWorkforceConfig({ teams: [{ slug: 'x', measure: { label: 'Bad', target: 0, source: { kind: 'agent-reported', counts: 'k' } } }] }, { workspaceYaml: null, teamYaml: new Map() })).toThrow();
    expect(() => planWorkforceConfig({ teams: [{ slug: '../escape' }] }, { workspaceYaml: null, teamYaml: new Map() })).toThrow();
  });

  it('keyFromLabel', () => {
    expect(keyFromLabel('Qualified referrals')).toBe('qualified_referrals');
    expect(keyFromLabel('$ Pipeline created!')).toBe('pipeline_created');
    expect(keyFromLabel('123')).toBe('measure');
  });
});
