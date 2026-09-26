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
    expect(listPluginSlugs()).toEqual(expect.arrayContaining(['data-rooms', 'growth-loop', 'proposals', 'software-factory', 'wiki']));

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

    // Four seats, one team: PM, Design, Eng, QA (2026-09-24). The planner's
    // work is the PM's; Design has an agent instead of an empty-seat comment.
    expect(factory.agents).toEqual(['change-reviewer', 'designer', 'product-manager', 'task-engineer']);
    expect(factory.skills).toEqual(['design-the-change', 'rank-the-backlog', 'review-against-contract', 'rubric-designer', 'rubric-engineer', 'rubric-product-manager', 'rubric-qa', 'surface-an-ask-as-a-card', 'triage-request', 'write-architecture-plan', 'write-release-notes', 'write-task-contract']);
    expect(factory.playbooks).toEqual(['designing-a-surface', 'house-voice', 'naming-the-work', 'verify-against-reality']);
    expect(factory.objectTypes).toEqual(['architecture_plan', 'engineering_task', 'product', 'release', 'repo', 'request']);
    // Three missions carry the loop; the eight reporting and hygiene missions are gone.
    expect(factory.missions).toEqual(['close-the-gap', 'prove-the-contract', 'tell-the-requester']);
    expect(factory.automations).toEqual(['contract-red-team-change', 'contract-red-team-evidence', 'contract-red-team-proposal', 'factory-ci-failure', 'factory-daily-plan', 'factory-decision-landed', 'factory-request-intake', 'factory-result-check', 'product-debrief', 'standard-from-shipped', 'tell-the-requester-check']);
    // Three pages a product exec decides from, plus the hidden work item.
    expect(factory.pages).toEqual(['feature', 'products', 'releases', 'work']);
    expect(factory.hasTrust).toBe(true);
  });

  it('refuses an unknown slug and names the catalogue', () => {
    expect(() => loadPlugin('nope')).toThrow(/unknown plugin "nope" — this core ships: data-rooms, growth-loop, proposals, software-factory, wiki/);
  });

  it('counts what the growth loop ships', () => {
    const growth = pluginContents(loadPlugin('growth-loop'));

    expect(growth.agents).toEqual(['content-producer', 'demand-strategist', 'growth-analyst', 'growth-lead', 'standards-editor']);
    expect(growth.skills).toEqual(['check-against-the-brief', 'extend-the-team', 'produce-from-a-brief', 'rank-the-demand', 'take-the-reading', 'write-a-growth-brief']);
    expect(growth.playbooks).toEqual(['measure-before-you-make', 'one-claim-per-piece', 'publish-what-holds']);
    // ONE new noun. The brief is the whole addition to the object model: no
    // second intake type, no second scorecard type, no second cost record.
    expect(growth.objectTypes).toEqual(['growth_brief']);
    expect(growth.missions).toEqual(['every-brief-measured', 'nothing-public-unchecked', 'the-team-inside-its-budget', 'what-gets-briefed']);
    // Every way an agent in the loop acts is an automation a person can read
    // and pause, never a habit in a prompt.
    expect(growth.automations).toEqual(['growth-capability-review', 'growth-debrief', 'growth-gate', 'growth-readings-due', 'growth-weekly-plan']);
    expect(growth.pages).toEqual(['growth-briefs', 'growth-cost', 'growth-measure', 'growth-team-report']);
    expect(growth.hasTrust).toBe(true);
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
    expect(ws.sha).toContain('+wiki@1.4.0');
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
    expect(ws.objectTypes.map(o => o.slug).sort()).toEqual(['architecture_plan', 'engineering_task', 'product', 'release', 'repo', 'request']);

    // The board's counters are on the product record, each described as agent-maintained.
    const product = ws.objectTypes.find(o => o.slug === 'product')?.schema as { properties: Record<string, { description?: string }> };
    for (const key of ['p1Open', 'shippedThisMonth', 'medianDaysToShip', 'health']) {
      expect(product.properties[key]?.description).toContain('AGENT-MAINTAINED');
    }
    // Open work, in-flight and the last release are rollups over the request
    // and release records now, joined by slug (2026-09-24) — never stale.
    for (const key of ['openRequests', 'inFlight', 'lastReleaseAt']) {
      expect(product.properties[key]?.description).toContain('COUNTED FROM THE RECORDS');
    }
    const productType = ws.objectTypes.find(o => o.slug === 'product');

    expect(productType?.rollups?.map(r => r.field)).toEqual(['openRequests', 'inFlight', 'awaitingDecision', 'lastReleaseAt']);
    expect(productType?.rollups?.[0]?.from).toEqual({ type: 'request', by: 'product', match: 'slug' });
    expect(productType?.rollups?.[3]).toMatchObject({ from: { type: 'release', by: 'product', match: 'slug' }, max: 'releasedAt' });

    // Playbooks a plugin ships are active and attached: through a skill's
    // frontmatter for the PM and QA, through `playbooks:` on the engineer,
    // which has no skill of its own.
    expect(ws.playbooks.map(p => p.slug).sort()).toEqual(['designing-a-surface', 'house-voice', 'naming-the-work', 'verify-against-reality']);
    expect(ws.skills.find(s => s.slug === 'triage-request')?.playbooks).toEqual(['naming-the-work']);
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.playbooks).toEqual(['verify-against-reality', 'house-voice', 'naming-the-work', 'designing-a-surface']);
    // The engineer runs outside the app (ADR 0004); the PM, the designer and
    // QA leave `runsOn` unset, which is how the in-process default stays
    // reachable.
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.harness?.runsOn).toBe('external-worker');
    expect(ws.agents.find(a => a.slug === 'product-manager')?.harness?.runsOn).toBeUndefined();
    expect(ws.agents.find(a => a.slug === 'designer')?.harness?.runsOn).toBeUndefined();
    expect(ws.missions.map(m => m.slug)).toHaveLength(3);
    // The trust ladder covers the eight actions core registers and nothing
    // else. A push runs on its own; a merge is a person's at the high bar;
    // every other rule ships disabled for the workspace to turn on.
    expect(ws.trust?.rules.map(r => r.action)).toEqual(['factory.dispatch_task', 'git.push_branch', 'git.merge', 'notify.requester', 'notify.requester.completion', 'notify.requester.sensitive', 'release.announce', 'deploy.release', 'deploy.provision', 'aws.mutate', 'credentials.write']);
    // A routine completion may earn its way; a decline or an incident is a person's every time.
    expect(ws.trust?.rules.find(r => r.action === 'notify.requester.completion')).toMatchObject({ enabled: false, risk: 'medium', autoApproveAbove: 0.9 });
    expect(ws.trust?.rules.find(r => r.action === 'notify.requester.sensitive')).toMatchObject({ enabled: false, risk: 'high', autoApproveAbove: 1 });
    expect(ws.trust?.rules.find(r => r.action === 'git.push_branch')).toMatchObject({ enabled: true, autoApproveAbove: 0.7 });
    expect(ws.trust?.rules.find(r => r.action === 'git.merge')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'high', autoApproveAbove: 1 });
    // Telling an asker and announcing a release are gated, medium-tier: they may earn their way, never start there.
    expect(ws.trust?.rules.find(r => r.action === 'notify.requester')).toMatchObject({ enabled: false, risk: 'medium' });
    expect(ws.trust?.rules.find(r => r.action === 'release.announce')).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'medium' });
    expect(ws.skills.find(s => s.slug === 'write-release-notes')?.playbooks).toEqual(['house-voice', 'naming-the-work']);
    // Two measures: what a person accepted, and who heard back inside a week. Performance is later.
    expect(ws.teams.find(t => t.slug === 'software-factory')?.measures.map(m => m.key)).toEqual(['tasks_accepted', 'answered_within_seven_days']);
    expect(ws.sha).toContain('+software-factory@2.6.0');
  });

  it('names the work: one playbook the PM, the engineer and QA all read', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [software-factory]\n'));
    const naming = ws.playbooks.find(p => p.slug === 'naming-the-work');

    // Five names, five jobs. The playbook is the one place they are told apart.
    expect(naming?.name).toBe('Naming the work');
    expect(naming?.body).toContain('request title');
    expect(naming?.body).toContain('task title');
    expect(naming?.body).toContain('commit subject');
    expect(naming?.body).toContain('pull request title');
    expect(naming?.body).toContain('release note');
    // Researched, not invented: the sources are cited by name and url.
    expect(naming?.body).toContain('https://www.conventionalcommits.org/en/v1.0.0/');
    expect(naming?.body).toContain('https://chris.beams.io/posts/git-commit/');
    expect(naming?.body).toContain('https://www.kernel.org/doc/html/latest/process/submitting-patches.html');
    expect(naming?.body).toContain('https://www.atlassian.com/agile/project-management/user-stories');

    // Reaches every seat that writes a name: the PM and QA through their
    // skills, the engineer through `playbooks:` on the agent.
    expect(ws.skills.find(s => s.slug === 'write-task-contract')?.playbooks).toEqual(['naming-the-work', 'designing-a-surface']);
    expect(ws.skills.find(s => s.slug === 'review-against-contract')?.playbooks).toEqual(['verify-against-reality', 'naming-the-work', 'designing-a-surface']);
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.playbooks).toContain('naming-the-work');

    // The contract skill requires the form and says what a reviewer returns.
    const contractSkill = ws.skills.find(s => s.slug === 'write-task-contract');

    expect(contractSkill?.body).toContain('The title names the change, literally');
    expect(contractSkill?.body).toContain('What fails review');
    expect(contractSkill?.body).toContain('Smoke test:');

    // Both prompts point at it by name, so neither seat invents its own house style.
    expect(ws.agents.find(a => a.slug === 'product-manager')?.resolvedSystemPrompt).toContain('naming-the-work');
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.resolvedSystemPrompt).toContain('naming-the-work');
  });

  it('writes the surface standard down once and attaches it to what writes and reviews a page', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [software-factory]\n'));
    const standard = ws.playbooks.find(p => p.slug === 'designing-a-surface');

    // The rule that has had to be said three times, and its companion.
    expect(standard?.name).toBe('Designing a surface');
    expect(standard?.body).toContain('Index pages display decisions and meaning. Detail pages display records and evidence');
    expect(standard?.body).toContain('A missing optional capability makes the interface smaller, not fuller');

    // The division the navigation expresses, recorded as intent: three pages
    // and the one place decisions are taken.
    for (const surface of ['Products', 'Work', 'Releases', 'Review']) {
      expect(standard?.body).toContain(surface);
    }

    // Pointed at, never duplicated: the specs live in metacto-vocion-agents.
    expect(standard?.body).toContain('Meta-CTO/metacto-vocion-agents');
    expect(standard?.body).toContain('## What fails review');

    // Attached, not decorative: every seat that writes or reviews a page.
    expect(ws.skills.find(s => s.slug === 'write-task-contract')?.playbooks).toContain('designing-a-surface');
    expect(ws.skills.find(s => s.slug === 'write-architecture-plan')?.playbooks).toContain('designing-a-surface');
    expect(ws.skills.find(s => s.slug === 'review-against-contract')?.playbooks).toContain('designing-a-surface');
    expect(ws.agents.find(a => a.slug === 'product-manager')?.playbooks).toContain('designing-a-surface');
    expect(ws.agents.find(a => a.slug === 'designer')?.playbooks).toContain('designing-a-surface');
    expect(ws.agents.find(a => a.slug === 'task-engineer')?.playbooks).toContain('designing-a-surface');
    expect(ws.agents.find(a => a.slug === 'change-reviewer')?.playbooks).toContain('designing-a-surface');

    // And the reviewer's own skill says what a page change is returned for.
    expect(ws.skills.find(s => s.slug === 'review-against-contract')?.body)
      .toContain('A change to a page is reviewed against the surface standard too');
  });

  it('seats four: a PM who owns the loop to the contract, a designer, an engineer and QA', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [software-factory]\n'));
    const pm = ws.agents.find(a => a.slug === 'product-manager');

    // In-app, the team's lead, with the planner's skills folded in: whoever
    // owns what to build owns turning it into something buildable.
    expect(pm?.origin).toBe('core');
    expect(pm?.team).toBe('software-factory');
    expect(ws.teams.find(t => t.slug === 'software-factory')?.lead).toBe('product-manager');
    expect(pm?.harness?.runsOn).toBeUndefined();
    expect(pm?.skills).toEqual(['surface-an-ask-as-a-card', 'triage-request', 'write-architecture-plan', 'write-task-contract', 'rank-the-backlog', 'write-release-notes', 'rubric-product-manager']);
    expect(pm?.objectTypes).toEqual(['request', 'architecture_plan', 'engineering_task', 'release', 'product', 'repo']);
    // The loop is named in the prompt, in the order a person sees it.
    expect(pm?.resolvedSystemPrompt).toContain('asked → decided → planned → building → QA → released');
    // A ui or flow request owes a mockup before it is decided; the PM hands it to the designer.
    expect(pm?.resolvedSystemPrompt).toContain('Prepare the commitment BEFORE you ask anyone to approve it');
    expect(pm?.resolvedSystemPrompt).toContain('The card\'s action is\n   `factory.dispatch_task` carrying the contract');
    expect(pm?.resolvedSystemPrompt).toContain('Blocked is only what you write');
    // The runs, not the task list, answer "what have you built" (2026-09-20).
    expect(pm?.resolvedSystemPrompt).toContain('list_recent_runs');
    expect(pm?.initiative).toBe('high');
    expect(pm?.handles).toEqual(expect.arrayContaining(['backlog', 'requests', 'plan this request', 'task contract', 'what is stuck', 'what shipped']));

    // Four seats, one team: each agent's eyebrow names its seat.
    expect(ws.agents.filter(a => a.team === 'software-factory').map(a => [a.slug, a.eyebrow]).sort()).toEqual([
      ['change-reviewer', 'Software factory · QA'],
      ['designer', 'Software factory · Design'],
      ['product-manager', 'Software factory · PM'],
      ['task-engineer', 'Software factory · Eng'],
    ]);
    expect(ws.agents.map(a => a.slug)).not.toContain('task-planner');

    // Design is a seat with an agent: the before visual on the request, the after-shot when it ships.
    const designer = ws.agents.find(a => a.slug === 'designer');

    expect(designer?.skills).toEqual(['design-the-change', 'rubric-designer']);
    expect(designer?.objectTypes).toEqual(['request', 'product']);
    expect(designer?.resolvedSystemPrompt).toContain('visuals.beforeArtifactIds');
    expect(designer?.resolvedSystemPrompt).toContain('visuals.afterArtifactIds');
    expect(ws.skills.find(s => s.slug === 'design-the-change')?.playbooks).toEqual(['designing-a-surface', 'house-voice']);

    // Every way the PM acts is an automation on one of its two missions —
    // visible, pausable, on /dashboard/automation and nowhere else.
    expect(ws.missions.find(m => m.slug === 'close-the-gap')?.agent).toBe('product-manager');
    expect(ws.missions.find(m => m.slug === 'tell-the-requester')?.agent).toBe('product-manager');
    expect(ws.missions.find(m => m.slug === 'prove-the-contract')?.agent).toBe('change-reviewer');
    expect(ws.automations.filter(a => a.agent === 'product-manager').map(a => a.slug).sort()).toEqual(['factory-ci-failure', 'factory-daily-plan', 'factory-decision-landed', 'factory-request-intake', 'factory-result-check', 'product-debrief', 'standard-from-shipped', 'tell-the-requester-check']);
    // The decision landing is what makes the card the commitment: approve freezes and queues, defer parks.
    expect(ws.automations.find(a => a.slug === 'factory-decision-landed')?.when).toEqual({ event: 'ask.decided', filter: { agentSlug: 'product-manager', kind: 'recommendation' } });
    expect(ws.automations.find(a => a.slug === 'factory-result-check')?.when.schedule).toBe('30 15 * * 1-5');
    expect(ws.automations.filter(a => a.agent === 'change-reviewer').map(a => a.slug).sort()).toEqual(['contract-red-team-change', 'contract-red-team-evidence', 'contract-red-team-proposal']);
    expect(ws.automations.every(a => ws.missions.some(m => m.slug === a.do.checkMission))).toBe(true);

    // The debrief: the factory finished something, the record learns it. On
    // core's completion events, authorizing and announcing nothing.
    const debrief = ws.automations.find(a => a.slug === 'product-debrief')!;

    expect(debrief).toMatchObject({ agent: 'product-manager', status: 'active' });
    expect(debrief.when.event).toEqual(['worker_run.completed', 'worker_run.failed', 'pr.merged']);
    expect(debrief.do.checkMission).toBe('close-the-gap');
    expect(debrief.do.prompt).toContain('Authorize nothing, announce nothing');

    // The score and the decision still live on the request record.
    const request = ws.objectTypes.find(o => o.slug === 'request')?.schema as { properties: Record<string, unknown> };
    for (const key of ['theme', 'icp', 'source', 'releaseId', 'priority', 'priorityReason', 'rankedAt', 'recommendedAt', 'recommendedOutcome', 'recommendationState', 'decidedAt', 'decisionReason', 'visuals']) {
      expect(request.properties[key]).toBeDefined();
    }
  });
});

describe('loadWorkspace with the growth loop', () => {
  it('composes the five seats, the one new noun, the missions and the hire bar', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [growth-loop]\naccountableUser: ops@northwind.example\n'));

    expect(ws.enabledPlugins).toEqual(['growth-loop']);
    expect(ws.agents.map(a => a.slug).sort()).toEqual(['content-producer', 'demand-strategist', 'growth-analyst', 'growth-lead', 'standards-editor']);
    expect(ws.teams.map(t => t.slug)).toEqual(['growth-loop']);
    expect(ws.objectTypes.map(o => o.slug)).toEqual(['growth_brief']);
    expect(ws.missions.map(m => m.slug).sort()).toEqual(['every-brief-measured', 'nothing-public-unchecked', 'the-team-inside-its-budget', 'what-gets-briefed']);

    // The hire is held at approval and tiered `medium`, so the ladder's ceiling
    // for it is execute-within-bounds — autonomous is never on offer for an
    // agent adding an agent, on any ledger.
    const hire = ws.trust?.rules.find(r => r.action === 'team.hire_agent');

    expect(hire).toMatchObject({ enabled: false, rung: 'execute-with-approval', risk: 'medium' });
  });

  it('ships ONE new noun and links to the factory\'s intake rather than shipping a second one', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [growth-loop, software-factory]\naccountableUser: ops@northwind.example\n'));
    const types = ws.objectTypes.map(o => o.slug).sort();

    // `request` comes from the software factory and from nowhere else; the
    // growth loop adds `growth_brief` and stops. Two plugins shipping one slug
    // is an error, and a second intake noun would be the duplication this
    // plugin's design argued against.
    expect(types).toEqual(['architecture_plan', 'engineering_task', 'growth_brief', 'product', 'release', 'repo', 'request']);

    const brief = ws.objectTypes.find(o => o.slug === 'growth_brief')!;
    const props = (brief.schema as { properties: Record<string, { description?: string }> }).properties;

    // The contract half is spelled the same as the task contract's, so a person
    // reads one vocabulary across both and core's cost machinery needs nothing new.
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['objective', 'acceptanceContract', 'decisionCost', 'estimateCents', 'actualCents', 'varianceCents', 'costUpdatedAt']));
    // And the half that makes it a different noun: a claim fence instead of a
    // path fence, and a verdict that arrives after publication.
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['doNotClaim', 'claimClass', 'measure', 'readAfterDays', 'readings', 'verdict']));
    expect(props.requestId!.description).toContain('OPTIONAL and cross-plugin');
    // A brief is a leaf: core writes its actual from the run, so it carries no
    // rollups and there is no second cost system underneath it.
    expect(brief.rollups ?? []).toEqual([]);
  });

  it('grades the team on what moved rather than on what was published', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [growth-loop]\naccountableUser: ops@northwind.example\n'));
    const team = ws.teams.find(t => t.slug === 'growth-loop')!;
    const keys = team.measures.map(m => m.key);

    expect(keys).toContain('briefs_that_worked');
    expect(team.measures.find(m => m.key === 'briefs_that_worked')!.dimension).toBe('outcome');
    // Velocity sits BESIDE the outcome, never instead of it — deliverables made
    // that moved nothing is exactly the failure the pair makes visible.
    expect(team.measures.find(m => m.key === 'deliverables_made')!.dimension).toBe('velocity');
    // Spend is the one measure that improves by going down.
    expect(team.measures.find(m => m.key === 'growth_cents')!.direction).toBe('lower');
  });

  it('composes beside every other shipped plugin without a slug collision', () => {
    const ws = loadWorkspace(makeWorkspace('plugins: [growth-loop, software-factory, wiki, proposals]\naccountableUser: ops@northwind.example\n'));
    const slugs = ws.agents.map(a => a.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(ws.enabledPlugins).toEqual(['growth-loop', 'software-factory', 'wiki', 'data-rooms', 'proposals']);

    // One rule per action across the merged ladder: the growth loop deliberately
    // does not restate a bar another plugin already holds.
    const actions = (ws.trust?.rules ?? []).map(r => r.action);

    expect(new Set(actions).size).toBe(actions.length);
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
