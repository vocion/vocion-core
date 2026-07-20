import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { assertTeams, effectiveTeamSlug } from './teams';

const agent = (slug: string, team?: string) => ({ slug, team, sourceFile: `agents/${slug}.yaml` });
const team = (slug: string, overrides: Partial<{ lead: string; accountableUser: string }> = {}) => ({
  slug,
  sourceFile: `teams/${slug}.yaml`,
  ...overrides,
});

describe('assertTeams', () => {
  it('accepts teams with resolving leads, member refs, and a workspace lead', () => {
    expect(() => assertTeams(
      [agent('revenue-lead'), agent('pipeline-analyst', 'revenue-ops'), agent('proposal-writer', 'revenue-ops')],
      [team('revenue-ops', { lead: 'revenue-lead' })],
      { lead: 'revenue-lead' },
    )).not.toThrow();
  });

  it('rejects an agent team: ref that names a missing team — and says which', () => {
    expect(() => assertTeams(
      [agent('pipeline-analyst', 'deal-desk')],
      [team('revenue-ops')],
      {},
    )).toThrow(/references missing team "deal-desk"/);
  });

  it('keeps legacy behavior for workspaces with no teams dir — free-text team is untouched', () => {
    expect(() => assertTeams(
      [agent('pipeline-analyst', 'Some Legacy Label')],
      [],
      {},
    )).not.toThrow();
  });

  it('rejects a team lead that is not an agent in the workspace', () => {
    expect(() => assertTeams(
      [agent('pipeline-analyst')],
      [team('revenue-ops', { lead: 'revenue-lead' })],
      {},
    )).toThrow(/unknown lead "revenue-lead"/);
  });

  it('allows a lead-less team (rendered "no lead yet", acceptance #11)', () => {
    expect(() => assertTeams(
      [agent('pipeline-analyst', 'revenue-ops')],
      [team('revenue-ops')],
      {},
    )).not.toThrow();
  });

  it('rejects a lead whose own team: names a different team', () => {
    expect(() => assertTeams(
      [agent('revenue-lead', 'deal-desk'), agent('x')],
      [team('revenue-ops', { lead: 'revenue-lead' }), team('deal-desk')],
      {},
    )).toThrow(/leads team "revenue-ops" but authors team "deal-desk"/);
  });

  it('rejects a workspace lead that is not an agent', () => {
    expect(() => assertTeams(
      [agent('pipeline-analyst')],
      [],
      { lead: 'revenue-director' },
    )).toThrow(/workspace lead "revenue-director" is not an agent/);
  });
});

describe('effectiveTeamSlug', () => {
  const teams = [
    { slug: 'revenue-ops', lead: 'revenue-lead' },
    { slug: 'deal-desk', lead: 'deal-desk-lead' },
  ];

  it('uses the authored team: when present', () => {
    expect(effectiveTeamSlug({ slug: 'pipeline-analyst', team: 'revenue-ops' }, teams)).toBe('revenue-ops');
  });

  it('auto-assigns a lead to the one team it leads', () => {
    expect(effectiveTeamSlug({ slug: 'revenue-lead' }, teams)).toBe('revenue-ops');
  });

  it('returns null for team-less agents and team-less workspaces', () => {
    expect(effectiveTeamSlug({ slug: 'hiring-manager' }, teams)).toBeNull();
    // No teams defined → legacy free-text team is NOT a slug ref.
    expect(effectiveTeamSlug({ slug: 'x', team: 'Legacy Label' }, [])).toBeNull();
  });

  it('does not guess when an agent leads multiple teams', () => {
    const both = [{ slug: 'a-team', lead: 'shared' }, { slug: 'b-team', lead: 'shared' }];

    expect(effectiveTeamSlug({ slug: 'shared' }, both)).toBeNull();
    expect(effectiveTeamSlug({ slug: 'shared', team: 'b-team' }, both)).toBe('b-team');
  });
});

describe('loadWorkspace with teams/', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function scratchWorkspace(opts: { manifestExtra?: string; teamYaml?: Record<string, string>; agentTeam?: string } = {}): string {
    dir = mkdtempSync(join(tmpdir(), 'cc-teams-'));
    writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: test_org\nname: test\n${opts.manifestExtra ?? ''}`);
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: Revenue Lead\nsystemPrompt: You lead revenue.\n');
    writeFileSync(join(dir, 'agents', 'pipeline-analyst.yaml'), `slug: pipeline-analyst\nname: Pipeline Analyst\nsystemPrompt: You analyze.\nparent: revenue-lead\n${opts.agentTeam ? `team: ${opts.agentTeam}\n` : ''}`);
    if (opts.teamYaml) {
      mkdirSync(join(dir, 'teams'));
      for (const [file, body] of Object.entries(opts.teamYaml)) {
        writeFileSync(join(dir, 'teams', file), body);
      }
    }
    return dir;
  }

  it('derives the team slug from the filename', () => {
    scratchWorkspace({
      teamYaml: { 'revenue-ops.yaml': 'name: Revenue Operations\nlead: revenue-lead\n' },
      agentTeam: 'revenue-ops',
    });
    const loaded = loadWorkspace(dir);

    expect(loaded.teams).toHaveLength(1);
    expect(loaded.teams[0]).toMatchObject({ slug: 'revenue-ops', name: 'Revenue Operations', lead: 'revenue-lead' });
  });

  it('loads workspace-level lead + accountableUser', () => {
    scratchWorkspace({ manifestExtra: 'lead: revenue-lead\naccountableUser: chris@metacto.com\n' });
    const loaded = loadWorkspace(dir);

    expect(loaded.manifest.lead).toBe('revenue-lead');
    expect(loaded.manifest.accountableUser).toBe('chris@metacto.com');
  });

  it('rejects a team filename that is not a valid slug', () => {
    scratchWorkspace({ teamYaml: { 'Revenue Ops.yaml': 'name: Revenue Operations\n' } });

    expect(() => loadWorkspace(dir)).toThrow(/not a valid team slug/);
  });

  it('rejects an agent whose team: names no teams/ file, naming the missing team', () => {
    scratchWorkspace({
      teamYaml: { 'revenue-ops.yaml': 'name: Revenue Operations\n' },
      agentTeam: 'deal-desk',
    });

    expect(() => loadWorkspace(dir)).toThrow(/references missing team "deal-desk"/);
  });

  it('loads a teams-free workspace exactly as before (teams: [])', () => {
    scratchWorkspace();
    const loaded = loadWorkspace(dir);

    expect(loaded.teams).toEqual([]);
  });
});
