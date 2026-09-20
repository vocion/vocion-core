import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';
import { enabledPluginsFromWorkspaceDir, listPlugins, listPluginSlugs, loadPlugin, pluginContents, resolvePlugins } from './plugins';

// Workspace plugins — the abstract rung made installable. Exercised through
// the real shipped plugins (templates/plugins) so a broken plugin fails here.

const dirs: string[] = [];

function makeWorkspace(manifestBody: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: test_org\nname: test\n${manifestBody}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('the shipped catalogue', () => {
  it('ships wiki, data-rooms, proposals and software-factory, each with a valid manifest', () => {
    expect(listPluginSlugs()).toEqual(expect.arrayContaining(['data-rooms', 'proposals', 'software-factory', 'wiki']));

    for (const p of listPlugins()) {
      expect(p.manifest.slug).toBe(p.sourcePath.split('/').pop());
      expect(p.manifest.description.length).toBeGreaterThan(20);
      expect(p.contents.hasReadme).toBe(true);
    }
  });

  it('counts what each plugin ships', () => {
    const wiki = pluginContents(loadPlugin('wiki'));

    expect(wiki.agents).toEqual(['wiki-curator']);
    expect(wiki.skills).toEqual(['wiki-context', 'wiki-curation']);
    expect(wiki.pages).toEqual(['wiki', 'wiki-guide']);
    expect(wiki.automations).toEqual(['wiki-index', 'wiki-weekly-curation']);
    expect(wiki.hasTrust).toBe(true);
  });

  it('counts what the software factory ships', () => {
    const factory = pluginContents(loadPlugin('software-factory'));

    expect(factory.agents).toEqual(['change-reviewer', 'task-engineer', 'task-planner']);
    expect(factory.skills).toEqual(['review-against-contract', 'write-task-contract']);
    expect(factory.objectTypes).toEqual(['engineering_task']);
    expect(factory.missions).toEqual(['close-the-gap', 'no-open-p1']);
    expect(factory.pages).toEqual(['factory-floor']);
    expect(factory.hasTrust).toBe(true);
  });

  it('refuses an unknown slug and names the catalogue', () => {
    expect(() => loadPlugin('nope')).toThrow(/unknown plugin "nope" — this core ships: data-rooms, proposals, software-factory, wiki/);
  });
});

describe('resolvePlugins — dependency order', () => {
  it('pulls a dependency in before the plugin that needs it, once', () => {
    const order = resolvePlugins(['proposals']).map(p => p.manifest.slug);

    expect(order).toEqual(['data-rooms', 'proposals']);
  });

  it('keeps authored order for independent plugins and dedupes', () => {
    const order = resolvePlugins(['wiki', 'proposals', 'data-rooms', 'wiki']).map(p => p.manifest.slug);

    expect(order).toEqual(['wiki', 'data-rooms', 'proposals']);
  });

  it('reads the enabled set straight from a workspace directory', () => {
    const dir = makeWorkspace('plugins: [proposals]\n');

    expect(enabledPluginsFromWorkspaceDir(dir).map(p => p.manifest.slug)).toEqual(['data-rooms', 'proposals']);
    expect(enabledPluginsFromWorkspaceDir(makeWorkspace(''))).toEqual([]);
  });
});

describe('loadWorkspace with plugins', () => {
  it('composes a plugin\'s resources under the workspace with origin core', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [wiki]\n'));

    expect(ws.enabledPlugins).toEqual(['wiki']);
    expect(ws.agents.map(a => a.slug)).toContain('wiki-curator');
    expect(ws.agents.find(a => a.slug === 'wiki-curator')?.origin).toBe('core');
    expect(ws.agents.find(a => a.slug === 'wiki-curator')?.resolvedSystemPrompt).toContain('true, small and read');
    expect(ws.skills.map(s => s.slug)).toEqual(expect.arrayContaining(['wiki-curation', 'wiki-context']));
    expect(ws.skills.find(s => s.slug === 'wiki-curation')?.origin).toBe('core');
    expect(ws.missions.map(m => m.slug)).toContain('wiki-current');
    expect(ws.automations.map(a => a.slug)).toEqual(expect.arrayContaining(['wiki-index', 'wiki-weekly-curation']));
    expect(ws.teams.map(t => t.slug)).toContain('wiki');
    expect(ws.trust?.rules.find(r => r.action === 'wiki.write_page')?.autoApproveAbove).toBe(0.6);
    expect(ws.sha).toContain('+wiki@1.0.0');
  });

  it('turns on a dependency and its surfaces with the plugin that needs it', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [proposals]\n'));

    expect(ws.enabledPlugins).toEqual(['data-rooms', 'proposals']);
    expect(ws.effectiveSurfaces).toEqual(['proposals']);
    expect(ws.objectTypes.map(o => o.slug)).toContain('data_room');
    expect(ws.agents.map(a => a.slug)).toEqual(expect.arrayContaining(['room-keeper', 'proposal-writer']));
    expect(ws.sha).toContain('+data-rooms@1.0.0+proposals@1.0.0');
  });

  it('lets a plugin shadow a base-pack default, and the workspace patch the plugin\'s version', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@2.1.0\nuse:\n  agents: [proposal-writer]\nplugins: [proposals]\n',
      { 'agents/proposal-writer.yaml': 'extends: core\nslug: proposal-writer\nmodel: test-model\nskills: {$append: [house-style]}\n', 'skills/house-style/SKILL.md': '---\nslug: house-style\nname: House style\ndescription: ws\n---\n\nbody\n' },
    ));
    const pw = ws.agents.find(a => a.slug === 'proposal-writer');

    // The plugin's writer (document skill), not the base brief-only one; the patch layered on top.
    expect(pw?.origin).toBe('merged');
    expect(pw?.model).toBe('test-model');
    expect(pw?.skills).toEqual(expect.arrayContaining(['proposal-document', 'data-rooms', 'house-style']));
    expect(pw?.skills).not.toContain('proposal-brief');
  });

  it('a workspace file with a plugin slug and no extends marker is a hard error', () => {
    expect(() => loadWorkspace(makeWorkspace(
      'plugins: [wiki]\n',
      { 'agents/wiki-curator.yaml': 'slug: wiki-curator\nname: Mine\nsystemPrompt: x\n' },
    ))).toThrow(/collides with a base default — add `extends: core`/);
  });

  it('a same-slug workspace skill replaces the plugin skill whole-file (origin override)', () => {
    const ws = loadWorkspace(makeWorkspace(
      'plugins: [wiki]\n',
      { 'skills/wiki-context/SKILL.md': '---\nslug: wiki-context\nname: Using the wiki\ndescription: ours\n---\n\nOurs wins.\n' },
    ));
    const skill = ws.skills.find(s => s.slug === 'wiki-context');

    expect(skill?.origin).toBe('override');
    expect(skill?.body).toBe('Ours wins.');
  });

  it('a workspace automation or team with the plugin\'s slug replaces it outright', () => {
    const ws = loadWorkspace(makeWorkspace(
      'plugins: [wiki]\n',
      { 'automations/wiki-weekly-curation.yaml': 'slug: wiki-weekly-curation\nagent: wiki-curator\nwhen:\n  schedule: "0 9 * * 1"\ndo:\n  checkMission: wiki-current\n' },
    ));
    const auto = ws.automations.find(a => a.slug === 'wiki-weekly-curation');

    expect(auto?.when.schedule).toBe('0 9 * * 1');
    expect(ws.automations.filter(a => a.slug === 'wiki-weekly-curation')).toHaveLength(1);
  });

  it('the workspace trust rule for the same action replaces the plugin\'s', () => {
    const ws = loadWorkspace(makeWorkspace(
      'plugins: [wiki]\n',
      { 'trust.yaml': 'rules:\n  - action: wiki.write_page\n    autoApproveAbove: 0.95\n    enabled: false\n' },
    ));
    const rule = ws.trust?.rules.find(r => r.action === 'wiki.write_page');

    expect(rule?.autoApproveAbove).toBe(0.95);
    expect(rule?.enabled).toBe(false);
    expect(ws.trust?.rules.filter(r => r.action === 'wiki.write_page')).toHaveLength(1);
  });

  it('disable: reaches a plugin agent — and everything that names it then fails loudly, naming the agent', () => {
    // The team it leads…
    expect(() => loadWorkspace(makeWorkspace('plugins: [wiki]\ndisable:\n  agents: [wiki-curator]\n'))).toThrow(/team "wiki" has unknown lead "wiki-curator"/);
    // …then the mission and automations it owns: disabling a plugin's agent
    // means overriding what refers to it, and each error says which.
    expect(() => loadWorkspace(makeWorkspace(
      'plugins: [wiki]\ndisable:\n  agents: [wiki-curator]\n',
      { 'teams/wiki.yaml': 'name: Wiki\n' },
    ))).toThrow(/wiki-curator/);
  });

  it('an unknown plugin fails the load with the catalogue named', () => {
    expect(() => loadWorkspace(makeWorkspace('plugins: [ledger]\n'))).toThrow(/unknown plugin "ledger"/);
  });

  it('no plugins and no pack is the unchanged path', () => {
    const ws = loadWorkspace(makeWorkspace(''));

    expect(ws.plugins).toEqual([]);
    expect(ws.enabledPlugins).toEqual([]);
    expect(ws.effectiveSurfaces).toEqual([]);
    expect(ws.agents).toEqual([]);
  });
});

describe('loadWorkspace with the software factory', () => {
  it('composes the worker agent, the task type, the missions and the merge bar', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [software-factory]\n'));

    expect(ws.enabledPlugins).toEqual(['software-factory']);
    expect(ws.objectTypes.map(o => o.slug)).toEqual(['engineering_task']);
    // The engineer runs outside the app (ADR 0004); the planner and reviewer
    // leave `runsOn` unset, which is how the in-process default stays
    // reachable.
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.harness?.runsOn).toBe('external-worker');
    expect(ws.agents.find(a => a.slug === 'task-planner')?.harness?.runsOn).toBeUndefined();
    expect(ws.missions.map(m => m.slug)).toEqual(['close-the-gap', 'no-open-p1']);
    // A push runs on its own; the merge is a person's, and no confidence
    // releases it.
    expect(ws.trust?.rules.find(r => r.action === 'git.push_branch')).toMatchObject({ enabled: true, autoApproveAbove: 0.7 });
    expect(ws.trust?.rules.find(r => r.action === 'git.merge_main')).toMatchObject({ enabled: false, rung: 'execute-with-approval' });
    expect(ws.teams.find(t => t.slug === 'software-factory')?.measures.map(m => m.key)).toContain('prs_opened');
    expect(ws.sha).toContain('+software-factory@1.0.0');
  });
});

describe('the client-documents template', () => {
  it('loads from plugins alone — writer, keeper, room type, surfaces', () => {
    const ws = loadWorkspace('packages/core/templates/workspaces/client-documents');

    expect(ws.enabledPlugins).toEqual(['data-rooms', 'proposals']);
    expect(ws.manifest.lead).toBe('proposal-writer');
    expect(ws.agents.map(a => a.slug).sort()).toEqual(['proposal-writer', 'room-keeper']);
    expect(ws.objectTypes.map(o => o.slug)).toEqual(['data_room']);
    expect(ws.effectiveSurfaces).toEqual(['proposals']);
    expect(ws.teams.map(t => t.slug).sort()).toEqual(['data-rooms', 'proposals']);
  });
});
