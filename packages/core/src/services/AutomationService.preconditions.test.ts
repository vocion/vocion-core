/**
 * An automation with a role has a precondition that is checked in code before
 * its run starts (#1028). The rule someone could get wrong: the hourly
 * tracker-intake pass costs no model call until a tracker source has
 * `intakeStatuses`, and the skip is on the record rather than silent.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 310 })),
}));

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { startWorkflow } = await import('@/services/WorkflowService');
const { fireAutomation } = await import('@/services/AutomationService');

const ORG = 'org_preconditions';

async function seedIntakeAutomation(role: string | undefined) {
  await db.insert(automationSchema).values({
    orgId: ORG,
    slug: 'tracker-intake',
    name: 'Pick up the roadmap',
    status: 'active',
    whenConfig: { schedule: '0 * * * 1-5' } as never,
    doConfig: { workflow: 'wf', ...(role ? { role } : {}) } as never,
  });
}

async function seedTracker(configJson: Record<string, unknown>, slug = 'jira') {
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug, kind: 'plugin', configJson: { baseUrl: 'https://northwind.atlassian.net', _connector: 'jira', ...configJson } });
}

beforeEach(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(knowledgeSourceSchema);
  vi.clearAllMocks();
});

describe('the tracker-intake precondition', () => {
  it('skips with no run started and a skipped row that says why, when no source has intakeStatuses', async () => {
    await seedIntakeAutomation('tracker-intake');
    await seedTracker({});
    await seedTracker({ intakeStatuses: [] }, 'jira-2');

    const outcome = await fireAutomation(ORG, 'tracker-intake', { invokedBy: 'automation:tracker-intake' });
    const rows = await db.select().from(automationRunSchema).where(eq(automationRunSchema.slug, 'tracker-intake'));

    expect(startWorkflow).not.toHaveBeenCalled();
    expect(outcome.result).toMatchObject({ kind: 'skipped', reason: 'precondition_unmet' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'skipped', status: 'ok' });
    expect(rows[0]!.result).toMatchObject({ reason: 'precondition_unmet', detail: expect.stringContaining('intakeStatuses') });
  });

  it('skips when the workspace has no tracker source at all', async () => {
    await seedIntakeAutomation('tracker-intake');

    await fireAutomation(ORG, 'tracker-intake', { invokedBy: 'automation:tracker-intake' });

    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it('runs when a source has intakeStatuses', async () => {
    await seedIntakeAutomation('tracker-intake');
    await seedTracker({ intakeStatuses: ['To Do'] });

    await fireAutomation(ORG, 'tracker-intake', { invokedBy: 'automation:tracker-intake' });

    expect(startWorkflow).toHaveBeenCalledTimes(1);
  });

  it('an automation with no role is never held by it', async () => {
    await seedIntakeAutomation(undefined);

    await fireAutomation(ORG, 'tracker-intake', { invokedBy: 'automation:tracker-intake' });

    expect(startWorkflow).toHaveBeenCalledTimes(1);
  });
});
