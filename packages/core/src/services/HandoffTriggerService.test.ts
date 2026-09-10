/**
 * The handoff watcher against PGlite: enrolled leads, a HubSpot contacts
 * mirror carrying reply and meeting timestamps, and the events that should
 * (and should not) come out of diffing the two.
 *
 * Style follows `SourceSyncService.events.test.ts`: real `emitEvent`, a mocked
 * workflow starter, assertions on the event log and on the lead row.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/WorkflowService', () => ({
  startWorkflow: vi.fn(async () => ({ id: 777 })),
}));

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema, knowledgeDocumentSchema, knowledgeSourceSchema, leadBriefSchema } = await import('@/models/Schema');
const { classifySignal, detectHandoffTriggers, watchForHandoffTriggers } = await import('@/services/HandoffTriggerService');
const { LEAD_MEETING_BOOKED, LEAD_REPLIED } = await import('@/services/EventService');

const ORG = 'org_handoff_watch';
const ENROLLED_AT = new Date('2026-09-05T10:00:00.000Z');

async function seedMirror(): Promise<number> {
  const [src] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug: 'hubspot-contacts', kind: 'plugin', configJson: { _connector: 'hubspot', objectType: 'contacts' } })
    .returning({ id: knowledgeSourceSchema.id });
  return src!.id;
}

async function seedContact(sourceId: number, hubspotId: string, signals: { repliedAt?: string; meetingAt?: string }) {
  await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId,
    externalId: `contacts:${hubspotId}`,
    title: `Contact ${hubspotId}`,
    contentHash: `hash-${hubspotId}-${signals.repliedAt ?? ''}-${signals.meetingAt ?? ''}`,
    metadata: {
      objectType: 'contacts',
      hubspotId,
      salesEmailLastRepliedAt: signals.repliedAt,
      latestMeetingActivityAt: signals.meetingAt,
    },
  });
}

async function seedLead(hubspotId: string, over: Partial<typeof leadBriefSchema.$inferInsert> = {}) {
  const [row] = await db.insert(leadBriefSchema).values({
    orgId: ORG,
    contactRef: `contacts:${hubspotId}`,
    contactName: `Lead ${hubspotId}`,
    triggerType: 'new',
    status: 'handed_off',
    decidedAt: ENROLLED_AT,
    ...over,
  }).returning();
  return row!;
}

async function clean() {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.delete(eventLogSchema);
  await db.delete(leadBriefSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
}

beforeEach(async () => {
  await clean();
  vi.clearAllMocks();
});

afterAll(clean);

describe('classifySignal', () => {
  const baseline = new Date('2026-09-05T10:00:00.000Z');

  it('fires for a signal newer than both what was seen and the enrollment', () => {
    expect(classifySignal(new Date('2026-09-08T00:00:00Z'), null, baseline)).toBe('fire');
    expect(classifySignal(new Date('2026-09-08T00:00:00Z'), new Date('2026-09-06T00:00:00Z'), baseline)).toBe('fire');
  });

  it('baselines a signal from before enrollment without firing', () => {
    expect(classifySignal(new Date('2026-08-01T00:00:00Z'), null, baseline)).toBe('baseline');
  });

  it('does nothing for an absent or already-seen signal', () => {
    expect(classifySignal(null, null, baseline)).toBe('none');
    expect(classifySignal(new Date('2026-09-08T00:00:00Z'), new Date('2026-09-08T00:00:00Z'), baseline)).toBe('none');
    expect(classifySignal(new Date('2026-09-07T00:00:00Z'), new Date('2026-09-08T00:00:00Z'), baseline)).toBe('none');
  });
});

describe('detectHandoffTriggers', () => {
  it('fires lead.replied once for a reply after enrollment, and remembers it', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '9412', { repliedAt: '2026-09-09T15:30:00.000Z' });
    const lead = await seedLead('9412');

    const first = await detectHandoffTriggers(ORG);

    expect(first).toMatchObject({ watched: 1, unmirrored: 0, baselined: 0 });
    expect(first.triggered).toEqual([expect.objectContaining({ leadBriefId: lead.id, contactRef: 'contacts:9412', trigger: 'reply', deduped: false })]);

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.type).toBe(LEAD_REPLIED);
    expect(logged?.payload).toMatchObject({
      leadBriefId: lead.id,
      contactRef: 'contacts:9412',
      hubspotId: '9412',
      contactName: 'Lead 9412',
      trigger: 'reply',
      observedAt: '2026-09-09T15:30:00.000Z',
    });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row?.handoffReplySeenAt?.toISOString()).toBe('2026-09-09T15:30:00.000Z');

    // The next sync sees the same timestamp: nothing new, nothing fired.
    const second = await detectHandoffTriggers(ORG);

    expect(second.triggered).toEqual([]);
    expect(await db.select().from(eventLogSchema)).toHaveLength(1);
  });

  it('fires lead.meeting_booked for a meeting, with the meeting column moving', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '77', { meetingAt: '2026-09-10T09:00:00.000Z' });
    await seedLead('77');

    const result = await detectHandoffTriggers(ORG);

    expect(result.triggered).toEqual([expect.objectContaining({ trigger: 'meeting' })]);

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.type).toBe(LEAD_MEETING_BOOKED);

    const [row] = await db.select().from(leadBriefSchema);

    expect(row?.handoffMeetingSeenAt?.toISOString()).toBe('2026-09-10T09:00:00.000Z');
    expect(row?.handoffReplySeenAt).toBeNull();
  });

  it('baselines a reply from before enrollment silently, then fires when a newer one lands', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '31', { repliedAt: '2026-08-20T08:00:00.000Z' });
    await seedLead('31');

    const first = await detectHandoffTriggers(ORG);

    expect(first).toMatchObject({ baselined: 1, triggered: [] });
    expect(await db.select().from(eventLogSchema)).toHaveLength(0);

    // The lead replies after enrollment: the mirror moves.
    await db.update(knowledgeDocumentSchema).set({
      metadata: { objectType: 'contacts', hubspotId: '31', salesEmailLastRepliedAt: '2026-09-09T12:00:00.000Z' },
    });

    const second = await detectHandoffTriggers(ORG);

    expect(second.triggered).toEqual([expect.objectContaining({ trigger: 'reply' })]);
  });

  it('watches only enrolled leads, and reports a lead the mirror does not carry', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '1', { repliedAt: '2026-09-09T15:30:00.000Z' });
    await seedLead('1', { status: 'ready_for_review' }); // not enrolled: a reply here is a review matter, not a handoff
    await seedLead('2'); // enrolled, but no mirror record

    const result = await detectHandoffTriggers(ORG);

    expect(result).toMatchObject({ watched: 1, unmirrored: 1, triggered: [] });
  });

  it('reaches an automation subscribed to lead.replied through emitEvent', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '9412', { repliedAt: '2026-09-09T15:30:00.000Z' });
    await seedLead('9412');
    await db.insert(automationSchema).values({
      orgId: ORG,
      slug: 'handoff-on-reply',
      name: 'handoff-on-reply',
      status: 'active',
      whenConfig: { event: LEAD_REPLIED } as never,
      doConfig: { workflow: 'write-handoff' } as never,
    });

    await detectHandoffTriggers(ORG);

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.triggered).toEqual([{ slug: 'automation:handoff-on-reply', runId: 777 }]);
  });

  it('accepts epoch-millisecond timestamps, which HubSpot also stamps', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '5', { repliedAt: String(Date.parse('2026-09-09T15:30:00.000Z')) });
    await seedLead('5');

    const result = await detectHandoffTriggers(ORG);

    expect(result.triggered[0]?.observedAt.toISOString()).toBe('2026-09-09T15:30:00.000Z');
  });
});

describe('watchForHandoffTriggers', () => {
  it('logs and swallows a failure instead of failing the sync', async () => {
    const log = vi.fn();
    const spy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('db gone');
    });

    const result = await watchForHandoffTriggers(ORG, log);

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith('error', 'contacts synced but the handoff watch failed', expect.objectContaining({ orgId: ORG, error: 'db gone' }));

    spy.mockRestore();
  });
});
