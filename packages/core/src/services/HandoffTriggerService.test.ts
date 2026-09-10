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

const { eq } = await import('drizzle-orm');
const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, eventLogSchema, knowledgeDocumentSchema, knowledgeSourceSchema, leadBriefSchema } = await import('@/models/Schema');
const { classifySignal, detectHandoffTriggers, readMeetingSignal, watchForHandoffTriggers } = await import('@/services/HandoffTriggerService');
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

/**
 * `meeting` is whatever the portal carries: a timestamp string, or "true"/"false" for a booking flag.
 * @param sourceId
 * @param hubspotId
 * @param signals
 * @param signals.repliedAt
 * @param signals.meeting
 */
async function seedContact(sourceId: number, hubspotId: string, signals: { repliedAt?: string; meeting?: string }) {
  await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId,
    externalId: `contacts:${hubspotId}`,
    title: `Contact ${hubspotId}`,
    contentHash: `hash-${hubspotId}-${signals.repliedAt ?? ''}-${signals.meeting ?? ''}`,
    metadata: {
      objectType: 'contacts',
      hubspotId,
      handoffReplyAt: signals.repliedAt,
      handoffMeeting: signals.meeting,
    },
  });
}

async function setMirror(hubspotId: string, signals: { repliedAt?: string; meeting?: string }) {
  await db.update(knowledgeDocumentSchema).set({
    metadata: { objectType: 'contacts', hubspotId, handoffReplyAt: signals.repliedAt, handoffMeeting: signals.meeting },
  }).where(eq(knowledgeDocumentSchema.externalId, `contacts:${hubspotId}`));
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
    await seedContact(sourceId, '77', { meeting: '2026-09-10T09:00:00.000Z' });
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
    await setMirror('31', { repliedAt: '2026-09-09T12:00:00.000Z' });

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

describe('readMeetingSignal', () => {
  it('reads a booking flag from "true"/"false" or a boolean, and anything else as a timestamp', () => {
    expect(readMeetingSignal('true')).toEqual({ kind: 'flag', set: true });
    expect(readMeetingSignal('False')).toEqual({ kind: 'flag', set: false });
    expect(readMeetingSignal(true)).toEqual({ kind: 'flag', set: true });
    expect(readMeetingSignal('2026-09-10T09:00:00.000Z')).toEqual({ kind: 'time', at: new Date('2026-09-10T09:00:00.000Z') });
    expect(readMeetingSignal(undefined)).toEqual({ kind: 'time', at: null });
  });
});

describe('detectHandoffTriggers with a boolean meeting flag (Calendly)', () => {
  const T1 = new Date('2026-09-09T10:00:00.000Z');
  const T2 = new Date('2026-09-09T11:00:00.000Z');
  const T3 = new Date('2026-09-09T12:00:00.000Z');

  it('a flag already set on the first watch is baselined, not fired', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '40', { meeting: 'true' });
    await seedLead('40');

    const result = await detectHandoffTriggers(ORG, { now: T1 });

    expect(result).toMatchObject({ baselined: 1, triggered: [] });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row?.handoffWatchedAt?.toISOString()).toBe(T1.toISOString());
    expect(row?.handoffMeetingSeenAt?.toISOString()).toBe(T1.toISOString());
  });

  it('a flag that flips to true on a later watch fires once, stamped with the watch time', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '41', { meeting: 'false' });
    const lead = await seedLead('41');

    const first = await detectHandoffTriggers(ORG, { now: T1 });

    expect(first).toMatchObject({ baselined: 0, triggered: [] });

    await setMirror('41', { meeting: 'true' });

    const second = await detectHandoffTriggers(ORG, { now: T2 });

    expect(second.triggered).toEqual([expect.objectContaining({ leadBriefId: lead.id, trigger: 'meeting', observedAt: T2, deduped: false })]);

    const [logged] = await db.select().from(eventLogSchema);

    expect(logged?.type).toBe(LEAD_MEETING_BOOKED);
    expect(logged?.payload).toMatchObject({ contactRef: 'contacts:41', trigger: 'meeting', observedAt: T2.toISOString() });

    // Still true on the next watch: nothing new.
    const third = await detectHandoffTriggers(ORG, { now: T3 });

    expect(third.triggered).toEqual([]);
    expect(await db.select().from(eventLogSchema)).toHaveLength(1);
  });

  it('a flag that clears resets the memory, so a re-booking fires again', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '42', { meeting: 'false' });
    await seedLead('42');
    await detectHandoffTriggers(ORG, { now: T1 });
    await setMirror('42', { meeting: 'true' });
    await detectHandoffTriggers(ORG, { now: T2 });
    await setMirror('42', { meeting: 'false' });

    await detectHandoffTriggers(ORG, { now: T2 });

    const [cleared] = await db.select().from(leadBriefSchema);

    expect(cleared?.handoffMeetingSeenAt).toBeNull();

    await setMirror('42', { meeting: 'true' });

    const again = await detectHandoffTriggers(ORG, { now: T3 });

    expect(again.triggered).toEqual([expect.objectContaining({ trigger: 'meeting', observedAt: T3 })]);
    expect(await db.select().from(eventLogSchema)).toHaveLength(2);
  });

  it('an absent flag on a lead with no meeting property changes nothing', async () => {
    const sourceId = await seedMirror();
    await seedContact(sourceId, '43', {});
    await seedLead('43');

    const result = await detectHandoffTriggers(ORG, { now: T1 });

    expect(result).toMatchObject({ baselined: 0, triggered: [] });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row?.handoffMeetingSeenAt).toBeNull();
    expect(row?.handoffWatchedAt?.toISOString()).toBe(T1.toISOString());
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
