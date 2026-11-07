/**
 * A RULE THAT PAYS OFF: the expert's answer to a run's question becomes a rule that says where it
 * came from, a later run records following it instead of asking, and the automation, the batch and
 * its report all count it. Against the real schema (PGlite), with fictional names.
 */
import type { BrowserStep } from '@/libs/browser/run';
import type { RoutineSpec } from '@/libs/routines/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/live/publish', () => ({ publish: async () => {} }));

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const svc = await import('./RoutineService');
const reads = await import('./routineReads');

const ORG = 'proj-cedar-learning';
const EXPERT = 'user-expert-learning';
const LMFT = 'LMFTs go through Hospital and other providers.';
const TAX = 'Type the tax ID by hand.';

const SPEC: RoutineSpec = {
  summary: 'Fill in the onboarding form for one group.',
  startUrl: 'https://larkspur.example/join',
  systems: ['larkspur.example'],
  inputs: [{ name: 'group', description: 'The group', key: true }],
  outputs: [{ name: 'application_id', description: 'The Application ID' }],
  preconditions: [],
  steps: [{ n: 1, text: 'Open the form', at: 80 }],
  rules: [{ text: TAX, at: 348 }],
  escalations: [{ when: 'A provider type has no rule', ask: 'Which path?', at: 123 }],
  prohibited: [],
  postconditions: [],
  writes: [],
  reconcile: null,
  questions: [],
  manualMinutes: 30,
};

let routineId = 0;
let askId = 0;

beforeAll(async () => {
  await db.insert(schema.userSchema).values({ id: EXPERT, email: 'specialist@larkfield.example', name: 'Marcus Hale' });
  await db.insert(schema.tenantAccountSchema).values({ id: 'acct-cedar-learning', slug: 'acct-cedar-learning', name: 'Cedar Hollow' });
  await db.insert(schema.projectSchema).values({ id: ORG, slug: ORG, name: 'Cedar Hollow', accountId: 'acct-cedar-learning' });
  const [r] = await db.insert(schema.routineSchema).values({ orgId: ORG, slug: 'group-application', name: 'Submit a group application', status: 'live', trust: 'approved', expertUserId: EXPERT, createdBy: EXPERT }).returning();
  routineId = r!.id;
  await db.insert(schema.routineVersionSchema).values({ orgId: ORG, routineId, n: 2, status: 'approved', spec: SPEC, task: 't', workflowYaml: 'y', approvedBy: EXPERT, approvedAt: new Date() });
  const [ask] = await db.insert(schema.askSchema).values({ orgId: ORG, kind: 'ruling', title: 'Which path should Samuel Okafor (LMFT) take?', options: [{ id: 'o1', label: 'Hospital and other providers' }], status: 'approved', decision: 'o1', decidedBy: EXPERT, decidedAt: new Date('2026-11-04T15:00:00Z') }).returning();
  askId = ask!.id;
});

async function runWith(batchId: number, n: number, label: string, steps: BrowserStep[]): Promise<number> {
  const [b] = await db.insert(schema.browserRunSchema).values({ orgId: ORG, userId: EXPERT, task: 't', proposedBy: 'routine:group-application', status: 'done', steps }).returning();
  await db.insert(schema.routineRunSchema).values({ orgId: ORG, routineId, batchId, version: 3, n, label, status: 'done', browserRunId: b!.id });
  return b!.id;
}

describe('a rule made from the expert\'s answer', () => {
  it('records the decision, who answered, when, and the version it enters', async () => {
    const added = await svc.addRoutineRule(ORG, EXPERT, routineId, LMFT, { askId });

    expect(added).toEqual({ version: 3, askId });

    const [v3] = await db.select().from(schema.routineVersionSchema).where(eq(schema.routineVersionSchema.n, 3));

    expect(v3!.status).toBe('draft');
    expect(v3!.spec.rules.at(-1)).toEqual({ text: LMFT, at: null, from: { askId, by: EXPERT, on: '2026-11-04T15:00:00.000Z', version: 3 } });
    // The taught rule keeps its moment and says nothing more.
    expect(v3!.spec.rules[0]).toEqual({ text: TAX, at: 348 });

    // A view reads the person by name.
    const view = await reads.getRoutine(ORG, routineId);

    expect(view!.draft!.spec.rules.at(-1)!.from).toMatchObject({ askId, by: 'Marcus Hale', version: 3 });
    expect(view!.versions.find(v => v.n === 3)!.rules).toEqual([{ text: LMFT, from: { askId, by: 'Marcus Hale', on: '2026-11-04T15:00:00.000Z', version: 3 }, runs: 0, recent: [] }]);
  });

  it('a rule from a decision that is not in this workspace still lands, naming the expert only', async () => {
    const added = await svc.addRoutineRule(ORG, EXPERT, routineId, 'Prescribers go through Medical providers.', { askId: 999_999 });

    expect(added).toEqual({ version: 3, askId: null });
  });
});

describe('a run that followed the rule', () => {
  it('is counted on the automation and on its batch, and said in the report', async () => {
    await svc.approveRoutineVersion(ORG, EXPERT, routineId);
    const [batch] = await db.insert(schema.routineBatchSchema).values({ orgId: ORG, routineId, version: 3, requestedBy: EXPERT, status: 'done' }).returning();
    const from = { askId, by: 'Marcus Hale', version: 3 };
    const at = '2026-11-05T15:00:00.000Z';
    const ruth = await runWith(batch!.id, 1, 'Cedar Hollow Counseling Group, LLC', [
      { n: 1, at, kind: 'open', label: 'Opened the form', ok: true },
      { n: 2, at, kind: 'rule', label: `Followed Marcus’s rule (v3): ${LMFT}`, why: 'Ruth Calloway (LMFT) goes through Hospital and other providers', ok: true, rule: { n: 2, text: LMFT, from } },
    ]);
    await runWith(batch!.id, 2, 'Cedar Hollow Family Therapy, LLC', [{ n: 1, at, kind: 'open', label: 'Opened the form', ok: true }]);

    const view = await reads.getRoutine(ORG, routineId);
    const use = view!.versions.find(v => v.n === 3)!.rules!.find(u => u.text === LMFT)!;

    expect(use.runs).toBe(1);
    expect(use.recent).toEqual([{ browserRunId: ruth, label: 'Cedar Hollow Counseling Group, LLC', decided: 'Ruth Calloway (LMFT) goes through Hospital and other providers' }]);

    const b = await reads.getBatch(ORG, batch!.id);

    expect(b!.rulesFollowed).toEqual([{ text: LMFT, from, runs: [{ n: 1, label: 'Cedar Hollow Counseling Group, LLC', browserRunId: ruth, decided: 'Ruth Calloway (LMFT) goes through Hospital and other providers' }] }]);

    const md = svc.reportMarkdown(b!);

    expect(md).toContain('## Rules it followed instead of asking');
    expect(md).toContain(`| ${LMFT} | [Marcus’s answer](/dashboard/inbox/${askId}), v3 | [1](/dashboard/browser/${ruth}) Cedar Hollow Counseling Group, LLC: Ruth Calloway (LMFT) goes through Hospital and other providers |`);
  });

  it('a batch where no rule decided anything says nothing about rules', async () => {
    const [batch] = await db.insert(schema.routineBatchSchema).values({ orgId: ORG, routineId, version: 3, requestedBy: EXPERT, status: 'done' }).returning();
    await runWith(batch!.id, 1, 'Cedar Hollow Psychiatry & Wellness, LLC', [{ n: 1, at: '2026-11-05T15:00:00.000Z', kind: 'open', label: 'Opened the form', ok: true }]);
    const b = await reads.getBatch(ORG, batch!.id);

    expect(b!.rulesFollowed).toEqual([]);
    expect(svc.reportMarkdown(b!)).not.toContain('Rules it followed');
  });
});
