/**
 * The Configure page's reads, on PGlite, against the software-factory plugin
 * as it ships in this repo: a seat's last run, an override that fell behind
 * the plugin, an automation whose newest fire could not start, the trust
 * ladder read off the plugin's own `trust.yaml`, and the changes a person
 * made. Every seeded name and id is fictional.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, automationRunSchema, automationSchema, autonomyPolicySchema, missionSchema, playbookSchema, toolCallSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { loadConfigure } = await import('./configureData');

const ORG = 'org_configure_fixture';
const NOW = new Date('2026-09-30T12:00:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function seed() {
  const [person] = await db.insert(userSchema).values({ id: 'user_configure_mara', email: 'mara@kestrel.example', name: 'Mara Okafor' }).returning({ id: userSchema.id });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'product-manager', name: 'Product manager', systemPrompt: 'x', eyebrow: 'Software factory · PM', role: 'lead', model: 'model-large' },
    { orgId: ORG, slug: 'change-reviewer', name: 'Change reviewer', systemPrompt: 'x', eyebrow: 'Software factory · QA', model: 'model-small' },
  ]);
  await db.insert(missionSchema).values({ orgId: ORG, slug: 'close-the-gap', name: 'No request waits a week', goal: 'x', agentSlug: 'product-manager' });
  await db.insert(toolCallSchema).values([
    { orgId: ORG, agentSlug: 'product-manager', tool: 'file_request', createdAt: ago(30) },
    { orgId: ORG, agentSlug: 'product-manager', tool: 'file_request', createdAt: ago(2) },
  ]);
  await db.insert(playbookSchema).values([
    { orgId: ORG, slug: 'triage-request', name: 'Triaging a request', description: 'x', kind: 'skill', origin: 'override', contentSha: 'ours', frontmatter: { baseSha: 'a-plugin-body-long-gone' } },
    { orgId: ORG, slug: 'rank-the-backlog', name: 'Ranking the backlog', description: 'x', kind: 'skill', origin: 'core', contentSha: 'theirs' },
  ]);
  await db.insert(automationSchema).values([
    { orgId: ORG, slug: 'factory-request-filed', name: 'A request was filed', description: 'Starts the work a filed request asks for. More words.', whenConfig: { event: 'object.created' }, doConfig: { job: 'x' } },
    { orgId: ORG, slug: 'factory-daily-plan', name: 'Daily plan', whenConfig: { schedule: '0 6 * * *' }, doConfig: { checkMission: 'close-the-gap' }, pausedAt: ago(5), pausedBy: person!.id, pausedNote: 'quiet week' },
  ]);
  await db.insert(automationRunSchema).values([
    { orgId: ORG, slug: 'factory-request-filed', kind: 'job', status: 'ok', startedAt: ago(10) },
    // The newest fire matched and could not start: an error on a skipped row.
    { orgId: ORG, slug: 'factory-request-filed', kind: 'skipped', status: 'error', error: 'matched object.created and could not start: no such job', startedAt: ago(1) },
    // A refusal on purpose is not a fire.
    { orgId: ORG, slug: 'factory-request-filed', kind: 'skipped', status: 'ok', startedAt: ago(0.5) },
    { orgId: ORG, slug: 'factory-daily-plan', kind: 'mission_check', status: 'ok', startedAt: ago(26) },
    { orgId: ORG, slug: 'factory-daily-plan', kind: 'control', status: 'ok', result: { kind: 'control', action: 'pause', by: { id: person!.id, name: 'Mara Okafor' } }, startedAt: ago(5) },
  ]);
  await db.insert(autonomyPolicySchema).values([
    // The apply wrote this rung from the plugin's own file: part of that
    // apply, not a change of its own.
    { orgId: ORG, actionId: 'git.merge', rung: 'execute-with-approval', riskTier: 'high', source: 'trust.yaml', promotedAt: ago(3), promotedBy: 'trust.yaml' },
    // A merge class the workspace let merge itself.
    { orgId: ORG, actionId: 'git.merge.docs', rung: 'execute-within-bounds', riskTier: 'low', minConfidence: 0.9, promotedAt: ago(48), promotedBy: person!.id, source: 'app' },
  ]);
  await db.insert(workspaceVersionSchema).values({ orgId: ORG, sha: 'abc123', status: 'applied', summary: { skills: { created: 0, updated: 2, unchanged: 11 } }, appliedBy: person!.id, appliedAt: ago(3) });
}

describe('loadConfigure', async () => {
  await seed();
  const input = await loadConfigure(ORG, 'software-factory', NOW);

  it('reads every seat the plugin ships, with what it owns and when it last ran', () => {
    const pm = input.seats.find(s => s.slug === 'product-manager');

    expect(input.seats.map(s => s.slug).sort()).toEqual(['change-reviewer', 'designer', 'product-manager', 'release-engineer', 'task-engineer']);
    expect(pm).toMatchObject({ name: 'Product manager', seat: 'Software factory · PM', role: 'lead', model: 'model-large', owns: ['No request waits a week'] });
    expect(pm?.lastRunAt?.toISOString()).toBe(ago(2).toISOString());
    expect(input.seats.find(s => s.slug === 'change-reviewer')?.lastRunAt).toBeNull();
  });

  it('marks an override apart from the plugin, and knows when the plugin moved on underneath it', () => {
    const triage = input.skills.find(s => s.slug === 'triage-request');

    expect(triage).toMatchObject({ source: 'override', drifted: true });
    expect(input.skills.find(s => s.slug === 'rank-the-backlog')).toMatchObject({ source: 'plugin', drifted: false });
    // A plugin skill the apply never wrote says so rather than passing as shipped.
    expect(input.skills.find(s => s.slug === 'write-release-notes')?.source).toBe('missing');
    expect(input.skills.some(s => s.kind === 'playbook')).toBe(true);
  });

  it('reads each automation\'s newest fire, including one that could not start', () => {
    const filed = input.automations.find(a => a.slug === 'factory-request-filed');
    const daily = input.automations.find(a => a.slug === 'factory-daily-plan');

    expect(filed?.last).toMatchObject({ status: 'error', failedToStart: true, error: 'matched object.created and could not start: no such job' });
    expect(filed?.trigger).toBe('On object.created');
    expect(filed?.does).toBe('Starts the work a filed request asks for.');
    expect(daily?.paused).toMatchObject({ by: 'Mara Okafor', note: 'quiet week' });
    expect(daily?.last?.status).toBe('ok');
  });

  it('reads the trust ladder off the plugin\'s rules, with the merge classes the workspace wrote beside them', () => {
    const merge = input.trust.find(t => t.key === 'git.merge');
    const docs = input.trust.find(t => t.key === 'git.merge.docs');
    const branch = input.trust.find(t => t.key === 'git.push_branch');

    expect(merge?.runsOnItsOwn).toBe(false);
    expect(docs).toMatchObject({ parent: 'git.merge', runsOnItsOwn: true, minConfidence: 0.9, risk: 'low' });
    // The class reads as its own rung, not as a second "Merge a branch".
    expect(docs?.name).toBe(`${merge?.name} · docs`);
    // Right after the merge rule it refines.
    expect(input.trust.indexOf(docs!)).toBe(input.trust.indexOf(merge!) + 1);
    // No row yet: the plugin's own rule says what the apply will write.
    expect(branch?.runsOnItsOwn).toBe(true);
  });

  it('lists what people changed, and who', () => {
    const byAt = [...input.changes].sort((a, b) => b.at.getTime() - a.at.getTime());

    expect(byAt.map(c => [c.what, c.who, c.href])).toEqual([
      ['Workspace applied · 2 changes', 'Mara Okafor', '/dashboard/workspace'],
      ['Paused Daily plan', 'Mara Okafor', '/dashboard/automation/factory-daily-plan'],
      ['Merge a branch · docs → Execute within bounds', 'Mara Okafor', '/dashboard/autonomy'],
    ]);
  });

  it('reads the plugin\'s team measures', () => {
    expect(input.measures.map(m => m.id)).toEqual(expect.arrayContaining(['software-factory/tasks_accepted']));
    expect(input.measures.every(m => m.window && m.direction)).toBe(true);
  });
});
