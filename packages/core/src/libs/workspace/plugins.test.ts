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

    expect(wiki.agents).toEqual(['wiki-curator', 'wiki-researcher']);
    expect(wiki.skills).toEqual(['wiki-context', 'wiki-curation', 'wiki-research']);
    expect(wiki.pages).toEqual(['wiki', 'wiki-guide']);
    expect(wiki.automations).toEqual(['conversation-sweep', 'wiki-debrief', 'wiki-index', 'wiki-weekly-curation']);
    expect(wiki.missions).toEqual(['wiki-current', 'wiki-debrief']);
    expect(wiki.hasTrust).toBe(true);
  });

  it('counts what the software factory ships', () => {
    const factory = pluginContents(loadPlugin('software-factory'));

    expect(factory.agents).toEqual(['change-reviewer', 'product-manager', 'task-engineer', 'task-planner']);
    expect(factory.skills).toEqual(['ideate-from-evidence', 'rank-the-backlog', 'recommend-in-batches', 'review-against-contract', 'triage-request', 'write-release-notes', 'write-task-contract']);
    expect(factory.playbooks).toEqual(['house-voice', 'the-twenty-percent', 'verify-against-reality', 'written-promises']);
    expect(factory.objectTypes).toEqual(['engineering_task', 'product', 'release', 'repo', 'request']);
    expect(factory.missions).toEqual(['close-the-gap', 'green-every-night', 'half-of-incumbent', 'keep-it-running', 'keep-the-board-honest', 'no-open-p1', 'product-debrief', 'product-review', 'stand-up-product', 'tell-the-requester']);
    // Every way the product manager acts is an automation — visible, pausable, named after the mission it serves.
    expect(factory.automations.filter(a => a.startsWith('product-'))).toEqual(['product-batch-decided', 'product-debrief', 'product-recommendations-check', 'product-tag-audit', 'product-weekly-review']);
    expect(factory.pages).toEqual(['backlog', 'changelog', 'costs', 'factory-floor', 'factory-log', 'portfolio', 'product-board', 'recommendations', 'releases', 'team-report']);
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
    expect(ws.sha).toContain('+wiki@1.2.0');
  });

  it('the wiki team pairs the researcher (lead, chat-facing, own ledger) with the curator (operational, shared bar)', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [wiki]\n'));
    const researcher = ws.agents.find(a => a.slug === 'wiki-researcher')!;
    const curator = ws.agents.find(a => a.slug === 'wiki-curator')!;

    expect(researcher.origin).toBe('core');
    expect(researcher).toMatchObject({ team: 'wiki', agentType: 'mission', temperature: '0.4', eyebrow: 'Wiki · Researcher' });
    expect(researcher.skills).toEqual(['wiki-research', 'wiki-context']);
    expect(researcher.harness.ownLedger).toEqual(['wiki.write_page']);
    expect(researcher.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(researcher.resolvedSystemPrompt).toContain('Read the wiki first');
    expect(curator).toMatchObject({ team: 'wiki', agentType: 'operational', temperature: '0.2' });
    expect(curator.harness.ownLedger).toBeUndefined();
    expect(ws.teams.find(t => t.slug === 'wiki')?.lead).toBe('wiki-researcher');
    expect(ws.skills.find(s => s.slug === 'wiki-research')?.origin).toBe('core');
    // The researcher declares what it handles and its initiative; the curator is the quiet one.
    expect(researcher.handles).toEqual(expect.arrayContaining(['wiki', 'standing rules', 'research', 'plan', 'decision']));
    expect(researcher.initiative).toBe('high');
    expect(curator.initiative).toBe('low');

    // The researcher's cadence is the work itself: a debrief on core's completion
    // events (one automation, four event types) plus the sweep that raises
    // `conversation.ended`. Nothing on a clock but the sweep.
    const researcherAutomations = ws.automations.filter(a => a.agent === 'wiki-researcher');

    expect(researcherAutomations.map(a => a.slug).sort()).toEqual(['conversation-sweep', 'wiki-debrief']);

    const debrief = researcherAutomations.find(a => a.slug === 'wiki-debrief')!;

    expect(debrief.when.event).toEqual(['worker_run.completed', 'mission_run.completed', 'conversation.ended', 'pr.merged']);
    expect(debrief.do.checkMission).toBe('wiki-debrief');
    expect(debrief.do.prompt).toContain('write_wiki_page');
    expect(ws.missions.find(m => m.slug === 'wiki-debrief')?.agent).toBe('wiki-researcher');
    expect(researcherAutomations.find(a => a.slug === 'conversation-sweep')?.do).toEqual({ job: 'sweep-idle-conversations', input: { idleMinutes: 30 } });
    // The researcher's writes start at review on their own ledger; the shared rule is untouched.
    expect(ws.trust?.rules.find(r => r.action === 'wiki.write_page.wiki-researcher')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'low', autoApproveAbove: 0.8 });
    expect(ws.trust?.rules.find(r => r.action === 'wiki.write_page')).toMatchObject({ enabled: true, rung: 'execute-within-bounds', autoApproveAbove: 0.6 });
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
    expect(() => loadWorkspace(makeWorkspace('plugins: [wiki]\ndisable:\n  agents: [wiki-researcher]\n'))).toThrow(/team "wiki" has unknown lead "wiki-researcher"/);
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
    expect(ws.objectTypes.map(o => o.slug).sort()).toEqual(['engineering_task', 'product', 'release', 'repo', 'request']);

    // The board's counters are on the product record, each described as agent-maintained.
    const product = ws.objectTypes.find(o => o.slug === 'product')?.schema as { properties: Record<string, { description?: string }> };
    for (const key of ['openRequests', 'p1Open', 'shippedThisMonth', 'medianDaysToShip', 'lastReleaseAt', 'health']) {
      expect(product.properties[key]?.description).toContain('AGENT-MAINTAINED');
    }

    // Playbooks a plugin ships are active and attached: through a skill's
    // frontmatter for the planner and reviewer, through `playbooks:` on the
    // engineer, which has no skill of its own.
    expect(ws.playbooks.map(p => p.slug).sort()).toEqual(['house-voice', 'the-twenty-percent', 'verify-against-reality', 'written-promises']);
    expect(ws.skills.find(s => s.slug === 'triage-request')?.playbooks).toEqual(['the-twenty-percent', 'written-promises']);
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.playbooks).toEqual(['verify-against-reality', 'house-voice']);
    // The engineer runs outside the app (ADR 0004); the planner and reviewer
    // leave `runsOn` unset, which is how the in-process default stays
    // reachable.
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.harness?.runsOn).toBe('external-worker');
    expect(ws.agents.find(a => a.slug === 'task-planner')?.harness?.runsOn).toBeUndefined();
    expect(ws.missions.map(m => m.slug)).toHaveLength(10);
    // A push runs on its own. A merge is one bar per risk class: docs may
    // earn its way to running within bounds (medium tier), promise never
    // does (high tier); every one starts at approval.
    expect(ws.trust?.rules.find(r => r.action === 'git.push_branch')).toMatchObject({ enabled: true, autoApproveAbove: 0.7 });
    expect(ws.trust?.rules.find(r => r.action === 'git.merge.docs')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'medium' });
    expect(ws.trust?.rules.find(r => r.action === 'git.merge.promise')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'high', autoApproveAbove: 1 });
    expect(ws.trust?.rules.filter(r => r.action.startsWith('git.merge.'))).toHaveLength(10);
    // Telling an asker and announcing a release are gated, medium-tier: they may earn their way, never start there.
    expect(ws.trust?.rules.find(r => r.action === 'notify.requester')).toMatchObject({ enabled: false, risk: 'medium' });
    expect(ws.trust?.rules.find(r => r.action === 'release.announce')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'medium' });
    expect(ws.skills.find(s => s.slug === 'write-release-notes')?.playbooks).toEqual(['house-voice', 'written-promises']);
    expect(ws.teams.find(t => t.slug === 'software-factory')?.measures.map(m => m.key)).toContain('prs_opened');
    expect(ws.sha).toContain('+software-factory@1.5.0');
  });

  it('seats a product manager who recommends and never authorizes, and says how, when and why it acts', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [software-factory]\n'));
    const pm = ws.agents.find(a => a.slug === 'product-manager');

    // In-app, on the factory team, with the three skills and the five nouns it reads.
    expect(pm?.origin).toBe('core');
    expect(pm?.team).toBe('software-factory');
    expect(pm?.harness?.runsOn).toBeUndefined();
    expect(pm?.skills).toEqual(['rank-the-backlog', 'recommend-in-batches', 'ideate-from-evidence']);
    expect(pm?.objectTypes).toEqual(['request', 'product', 'release', 'engineering_task', 'repo']);
    expect(pm?.resolvedSystemPrompt).toContain('Only when one of the plugin\'s automations fires');
    expect(pm?.resolvedSystemPrompt).toContain('ten, then pause');

    for (const slug of ['rank-the-backlog', 'recommend-in-batches', 'ideate-from-evidence']) {
      expect(ws.skills.find(s => s.slug === slug)?.playbooks).toEqual(['the-twenty-percent', 'written-promises']);
    }

    // Five disciplines, one team: each agent's eyebrow names its seat; Design is declared empty in the team file.
    expect(ws.agents.filter(a => a.team === 'software-factory').map(a => [a.slug, a.eyebrow])).toEqual(expect.arrayContaining([
      ['product-manager', 'Software factory · Product'],
      ['task-planner', 'Software factory · Architecture · Planner'],
      ['task-engineer', 'Software factory · Engineering · Engineer'],
      ['change-reviewer', 'Software factory · QA · Reviewer'],
    ]));
    expect(ws.teams.find(t => t.slug === 'software-factory')?.description).toContain('Design (no agent yet');
    // The throttle, read from the other side: decisions a person made on recommendation asks.
    expect(ws.teams.find(t => t.slug === 'software-factory')?.measures.find(m => m.key === 'recommendations_decided')?.source).toEqual({ kind: 'human-confirmed', askKinds: ['recommendation'] });

    // One mission, four triggers — every one a checkMission on it, so the WHEN lives on /dashboard/automation and nowhere else.
    const mission = ws.missions.find(m => m.slug === 'product-review');

    expect(mission?.agent).toBe('product-manager');

    const triggers = ws.automations.filter(a => a.do.checkMission === 'product-review');

    expect(triggers.map(a => a.slug).sort()).toEqual(['product-batch-decided', 'product-recommendations-check', 'product-tag-audit', 'product-weekly-review']);
    expect(triggers.every(a => a.agent === 'product-manager' && a.status === 'active' && a.do.prompt && a.description)).toBe(true);
    expect(triggers.find(a => a.slug === 'product-batch-decided')?.when).toEqual({ event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } });
    expect(triggers.find(a => a.slug === 'product-weekly-review')?.when.schedule).toBe(mission?.schedule);

    // The debrief: the factory finished something, the record learns it. Its own
    // mission, on core's completion events, authorizing and announcing nothing.
    const debrief = ws.automations.find(a => a.slug === 'product-debrief')!;

    expect(debrief).toMatchObject({ agent: 'product-manager', status: 'active' });
    expect(debrief.when.event).toEqual(['worker_run.completed', 'worker_run.failed', 'pr.merged']);
    expect(debrief.do.checkMission).toBe('product-debrief');
    expect(debrief.do.prompt).toContain('Authorize nothing, announce nothing');
    expect(ws.missions.find(m => m.slug === 'product-debrief')?.agent).toBe('product-manager');
    // Initiative and routing hints: the product manager takes ties and debriefs; the planner is the quiet default.
    expect(pm?.initiative).toBe('high');
    expect(pm?.handles).toEqual(expect.arrayContaining(['backlog', 'recommendations', 'requests']));
    expect(ws.agents.find(a => a.slug === 'task-planner')?.initiative).toBe('normal');
    expect(ws.agents.find(a => a.slug === 'task-planner')?.handles).toContain('task contract');

    // Recommending is a rung, not a gate; authorizing is one bar per class, low classes may earn it, promise never does.
    expect(ws.trust?.rules.find(r => r.action === 'product.recommend')).toMatchObject({ enabled: false, rung: 'recommend', risk: 'low' });
    expect(ws.trust?.rules.filter(r => r.action.startsWith('product.authorize.')).map(r => r.action)).toEqual(['product.authorize.docs', 'product.authorize.copy', 'product.authorize.deps', 'product.authorize.fix', 'product.authorize.feature', 'product.authorize.major', 'product.authorize.promise']);
    expect(ws.trust?.rules.find(r => r.action === 'product.authorize.docs')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'low' });
    expect(ws.trust?.rules.find(r => r.action === 'product.authorize.promise')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'high', autoApproveAbove: 1 });

    // The score, the batch and the decision all live on the request record.
    const request = ws.objectTypes.find(o => o.slug === 'request')?.schema as { properties: Record<string, unknown> };
    for (const key of ['theme', 'icp', 'source', 'releaseId', 'priority', 'priorityReason', 'rankedAt', 'recommendedAt', 'recommendationBatch', 'recommendedOutcome', 'recommendationState', 'decidedAt', 'decisionReason']) {
      expect(request.properties[key]).toBeDefined();
    }
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
