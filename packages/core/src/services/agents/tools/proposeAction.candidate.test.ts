/**
 * The agent path to the review queue, walked for real.
 *
 * Everything the unit tests cover starts one layer down, at `proposeAction`.
 * This file starts where an agent actually starts: a workspace on disk is
 * applied, the agent's own tool set is built, and the tool is called with the
 * exact payload its playbook documents. Nothing about the action is mocked —
 * the object type comes out of the applied workspace, the authz gate runs, and
 * the rows are read back from the database.
 *
 * The one thing left out is the model. Choosing which records to propose is
 * the model's job; carrying that choice safely to a human is the framework's,
 * and only the second half can be asserted. So the test plays the model: it
 * sends what `playbooks/candidate-extraction/SKILL.md` tells the agent to
 * send. If that file and this test drift apart, the payload below is the
 * thing to fix.
 */
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, playbookSchema, agentSchema } = await import('@/models/Schema');
const { loadWorkspace } = await import('@/libs/workspace/loader');
const { applyWorkspace } = await import('@/libs/workspace/applier');
const { proposeActionTool } = await import('./proposeAction');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { rejectAction } = await import('@/services/ActionService');
const { and, eq } = await import('drizzle-orm');

const ORG = 'proj_candidate_intake_test';
const AGENT_SLUG = 'listing-scout';
const WORKSPACE_PATH = resolve(import.meta.dirname, '../../../../demo/candidate-intake-workspace');

/** The tool needs somewhere to send progress events; nothing here reads them. */
function runtimeContext() {
  return {
    orgId: ORG,
    agentSlug: AGENT_SLUG,
    connectorSources: [],
    emit: () => {},
  } as never;
}

/**
 * One proposal, shaped exactly as the playbook's worked example shapes it.
 * @param over - Field overrides for the record itself.
 */
function proposalFor(over: Record<string, unknown> = {}) {
  return {
    action_id: 'objects.propose_candidate',
    action_input: {
      objectType: 'event_candidate',
      title: 'Open Mic Night',
      fields: {
        title: 'Open Mic Night',
        start: '2026-09-19T19:30',
        venue: 'The Flynn',
        price: 'Free',
        ...over,
      },
      dedupOn: ['title', 'start', 'venue'],
      sourceUrl: 'https://example.org/events/open-mic-night',
      sourceListingUrl: 'https://example.org/events',
      summary: 'Weekly open mic, sign-up from 7pm.',
    },
    confidence: 0.9,
    rationale: 'Listed on the venue\'s own events page with a date and a time.',
  };
}

async function pendingRuns() {
  return db
    .select()
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.status, 'pending')));
}

async function allRuns() {
  return db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
}

async function candidateObjects() {
  return db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
}

beforeEach(async () => {
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
  await db.delete(playbookSchema);
  await db.delete(agentSchema);
  forgetCachedObjectTypes();
});

describe('the workspace an agent is configured from', () => {
  it('loads and applies without a single error', async () => {
    const loaded = loadWorkspace(WORKSPACE_PATH);
    const result = await applyWorkspace(loaded, { orgId: ORG });

    expect(result.errors).toEqual([]);
    expect(result.counts.objectTypes.created).toBe(1);
    expect(result.counts.agents.created).toBe(1);
    expect(result.counts.playbooks.created).toBe(1);
  });

  it('gives the agent the playbook that tells it how to propose', async () => {
    const loaded = loadWorkspace(WORKSPACE_PATH);
    await applyWorkspace(loaded, { orgId: ORG });

    const [agent] = await db
      .select()
      .from(agentSchema)
      .where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, AGENT_SLUG)));

    // Without this the agent has the tool but not the instructions, and the
    // dedup rules — the part a wrong answer is expensive on — never reach it.
    expect(agent?.playbookSlugs).toContain('candidate-extraction');
    expect(agent?.objectTypeSlugs).toContain('event_candidate');
  });
});

describe('the agent proposing a candidate', () => {
  beforeEach(async () => {
    const loaded = loadWorkspace(WORKSPACE_PATH);
    await applyWorkspace(loaded, { orgId: ORG });
    forgetCachedObjectTypes();
  });

  it('offers objects.propose_candidate among the actions it can propose', async () => {
    const tool = proposeActionTool(runtimeContext());

    // The description is what the model reads to pick an action, so the
    // action being registered is not enough — it has to be listed here.
    expect(tool.description).toContain('objects.propose_candidate');
  });

  it('lands one pending queue item and one candidate row, attributed to the agent', async () => {
    const tool = proposeActionTool(runtimeContext());

    const said = await tool.invoke(proposalFor());

    expect(said).toMatch(/PENDING human approval/);

    const runs = await pendingRuns();
    const objects = await candidateObjects();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.actionId).toBe('objects.propose_candidate');
    expect(runs[0]?.invokedBy).toBe(`agent:${AGENT_SLUG}`);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ title: 'Open Mic Night', status: 'candidate' });
    // Proposed is not published: nothing outside has been told anything.
    expect(objects[0]?.externalId).toBeNull();
  });

  it('stores the record in metadata and where it came from in provenance', async () => {
    const tool = proposeActionTool(runtimeContext());

    await tool.invoke(proposalFor());
    const [object] = await candidateObjects();

    expect(object?.metadata).toMatchObject({ title: 'Open Mic Night', venue: 'The Flynn', price: 'Free' });
    // Bookkeeping lives apart from the record, so a schema-driven UI can
    // render metadata without filtering our own keys back out of it.
    expect(object?.metadata).not.toHaveProperty('sourceUrl');
    expect(object?.provenance).toMatchObject({
      sourceUrl: 'https://example.org/events/open-mic-night',
      sourceListingUrl: 'https://example.org/events',
      proposedBy: `agent:${AGENT_SLUG}`,
    });
  });

  it('refreshes the same item when the agent re-reads the page', async () => {
    const tool = proposeActionTool(runtimeContext());

    await tool.invoke(proposalFor());
    await tool.invoke(proposalFor({ price: '$5 suggested' }));

    // A second pass over the same listings page is the normal case, not the
    // exception. It must not double the reviewer's work.
    expect(await pendingRuns()).toHaveLength(1);
    expect(await candidateObjects()).toHaveLength(1);

    const [object] = await candidateObjects();

    expect(object?.metadata).toMatchObject({ price: '$5 suggested' });
  });

  it('keeps the same event on a different night as its own item', async () => {
    const tool = proposeActionTool(runtimeContext());

    await tool.invoke(proposalFor());
    await tool.invoke(proposalFor({ start: '2026-09-26T19:30' }));

    expect(await pendingRuns()).toHaveLength(2);
    expect(await candidateObjects()).toHaveLength(2);
  });

  it('tells a refresh apart from a new proposal in what it says back', async () => {
    const tool = proposeActionTool(runtimeContext());

    const first = await tool.invoke(proposalFor());
    const second = await tool.invoke(proposalFor({ price: '$5 suggested' }));

    // Both used to read "is PENDING human approval", so an agent re-reading a
    // page could not tell the reviewer it had added nothing new.
    expect(first).toMatch(/PENDING human approval/);
    expect(second).toMatch(/updated in place/i);
    expect(second).not.toMatch(/PENDING human approval/);
  });

  it('does not queue a candidate the moderator already rejected', async () => {
    const tool = proposeActionTool(runtimeContext());
    await tool.invoke(proposalFor());
    const [pending] = await pendingRuns();
    await rejectAction(pending!.id, ORG, 'not our kind of event', { reviewedBy: 'user-lili' });

    // The listing page is read again next week and still carries the event.
    const said = await tool.invoke(proposalFor());

    expect(said).toMatch(/already decided/i);
    expect(said).toContain('rejected');
    // Nothing new for the moderator, and no second candidate row.
    expect(await pendingRuns()).toHaveLength(0);
    expect(await allRuns()).toHaveLength(1);
    expect(await candidateObjects()).toHaveLength(1);
  });

  it('does not queue a candidate the moderator already approved', async () => {
    const tool = proposeActionTool(runtimeContext());
    await tool.invoke(proposalFor());
    const [pending] = await pendingRuns();
    const { executeAction } = await import('@/services/ActionService');
    await executeAction(pending!.id, ORG, { reviewedBy: 'user-jamie' });

    const said = await tool.invoke(proposalFor());

    expect(said).toMatch(/already decided/i);
    expect(await allRuns()).toHaveLength(1);
    expect(await candidateObjects()).toHaveLength(1);
  });

  it('still opens a fresh item for a genuinely new event on the same page', async () => {
    const tool = proposeActionTool(runtimeContext());
    await tool.invoke(proposalFor());
    const [pending] = await pendingRuns();
    await rejectAction(pending!.id, ORG, 'not our kind of event', { reviewedBy: 'user-lili' });

    await tool.invoke(proposalFor({ title: 'Poetry Slam', start: '2026-09-26T19:30' }));

    // Blocking the decided one must not blunt the tool: the new event on the
    // same listing page still reaches the moderator.
    expect(await pendingRuns()).toHaveLength(1);
  });

  it('refuses an object type the workspace never defined, and says so plainly', async () => {
    const tool = proposeActionTool(runtimeContext());
    const proposal = proposalFor();
    proposal.action_input.objectType = 'grant_deadline';

    const said = await tool.invoke(proposal);

    // The agent gets a sentence it can act on, not a stack trace. Nothing is
    // written: no candidate row, and no queue item a reviewer could open but
    // never approve. Saying "queued for approval" here would be a lie the
    // agent then repeats to a person.
    expect(said).toContain('Proposal refused (VALIDATION_FAILED)');
    expect(said).toContain('grant_deadline');
    expect(await candidateObjects()).toHaveLength(0);
    expect(await pendingRuns()).toHaveLength(0);
  });

  it('refuses a proposal with no dedupOn, and says so plainly — not a raw validation dump', async () => {
    // VEERIO-257 regression: `inputSchema.parse` throwing a ZodError used to
    // reach the model as `Proposal failed: [{"code":"custom",...}]` — the
    // hand-authored message buried in JSON. It must read like the precheck
    // refusal above: a plain sentence naming the fix.
    const tool = proposeActionTool(runtimeContext());
    const proposal = proposalFor();
    delete (proposal.action_input as { dedupOn?: string[] }).dedupOn;

    const said = await tool.invoke(proposal);

    expect(said).toContain('Proposal refused (VALIDATION_FAILED)');
    expect(said).toMatch(/dedupOn must list at least one field/);
    expect(said).not.toMatch(/"code":\s*"custom"/);
    expect(await candidateObjects()).toHaveLength(0);
    expect(await pendingRuns()).toHaveLength(0);
  });

  it('refuses a dedupOn nested inside fields, and says so plainly — not a raw validation dump', async () => {
    const tool = proposeActionTool(runtimeContext());
    // `proposalFor`'s override spreads into `fields`, so this is exactly the
    // VEERIO-257 shape that reached production: the real identity list
    // nested under `fields.dedupOn`, top-level `dedupOn` left as the
    // playbook's example.
    const proposal = proposalFor({ dedupOn: ['title'] });

    const said = await tool.invoke(proposal);

    expect(said).toContain('Proposal refused (VALIDATION_FAILED)');
    expect(said).toMatch(/dedupOn found inside fields/);
    expect(await candidateObjects()).toHaveLength(0);
    expect(await pendingRuns()).toHaveLength(0);
  });
});
