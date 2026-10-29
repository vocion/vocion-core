import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * personalization.enroll's basis and stale check: the contact as HubSpot
 * holds it (fetch, stubbed), and whether they are now in an email thread
 * (the mailbox's synced thread state, mocked).
 */
vi.mock('@/libs/DB');
vi.mock('@/services/agents/tools/hubspotDirect', () => ({
  hubspotTokenForActionSlug: async () => 'hubspot-token',
  hubspotClientForOrg: async () => ({ ok: false, error: 'no_hubspot_credentials', message: 'none' }),
}));
const activeThreadWith = vi.fn();
vi.mock('@/services/mail/replyThread', () => ({ activeThreadWith: (...args: unknown[]) => activeThreadWith(...args) }));
vi.mock('@/services/CrmRecordsService', () => ({ contactEmailByRef: async () => new Map([['contacts:9412', 'dana@northbeam.example']]) }));

const { personalizationEnrollAction } = await import('./personalization-enroll');

const PROPOSED = new Date('2026-10-22T09:00:00.000Z');
const CTX = { orgId: 'org_enroll_stale', credentials: { token: 'hubspot-token' }, proposedAt: PROPOSED };
const input = personalizationEnrollAction.inputSchema.parse({
  leadBriefId: 1,
  contactRef: 'contacts:9412',
  contactName: 'Dana Whitfield',
  sequenceId: 'seq-311',
  sequenceName: 'AI-Readiness Nurture',
  senderEmail: 'rowan@northwind.example',
  hubspotUserId: '77',
  sends: [{ step: 1, subject: 'Your platform hires', body: 'Dana, saw the hires.' }],
});

const quiet = {
  hs_sequences_is_enrolled: 'false',
  hs_latest_sequence_enrolled: null,
  hs_latest_sequence_enrolled_date: null,
  lifecyclestage: 'marketingqualifiedlead',
  hs_sales_email_last_replied: null,
  hs_latest_meeting_activity: null,
  notes_last_contacted: null,
  hs_email_optout: 'false',
};
const basis = {
  enrolled: false,
  latestSequenceId: null,
  lifecycleStage: 'marketingqualifiedlead',
  lastReplied: null,
  meeting: null,
  lastContacted: null,
  optedOut: false,
};

/**
 * HubSpot holds this contact, and this sequence enrollment when one is given.
 * @param properties
 * @param enrollment
 * @param enrollment.sequenceId
 * @param enrollment.sequenceName
 */
function hubspotHolds(properties: Record<string, string | null>, enrollment?: { sequenceId: string; sequenceName: string }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/enrollments/contact/')) {
      return { ok: Boolean(enrollment), status: enrollment ? 200 : 404, json: async () => enrollment ?? {}, text: async () => '' } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ id: '9412', properties }), text: async () => '' } as unknown as Response;
  }));
}

beforeEach(() => {
  activeThreadWith.mockReset().mockResolvedValue(null);
});

afterEach(() => vi.unstubAllGlobals());

describe('personalization.enroll: basis', () => {
  it('records enrollment, lifecycle, reply, meeting, last contacted and opt-out', async () => {
    hubspotHolds({ ...quiet, hs_sales_email_last_replied: '2026-09-01T10:00:00.000Z' });
    const out = await personalizationEnrollAction.basisFor!(CTX, input);

    expect(out).toEqual({ ...basis, lastReplied: '2026-09-01T10:00:00.000Z' });
  });
});

describe('personalization.enroll: stillHolds', () => {
  it('holds when the lead is where it was', async () => {
    hubspotHolds(quiet);

    await expect(personalizationEnrollAction.stillHolds!(CTX, input, basis)).resolves.toBeNull();
  });

  it('already in a sequence: names it and since when, kept open for the person, with the sequence\'s code', async () => {
    hubspotHolds({ ...quiet, hs_sequences_is_enrolled: 'true', hs_latest_sequence_enrolled: '5501', hs_latest_sequence_enrolled_date: '2026-10-25T14:00:00.000Z' }, { sequenceId: '5501', sequenceName: 'Q4 Nurture' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({
      line: 'Dana Whitfield is already in \'Q4 Nurture\' since Oct 25. Proceeding replaces it with \'AI-Readiness Nurture\'',
      keepOpen: true,
      code: 'already_enrolled:5501',
    });
  });

  it('replied after the proposal', async () => {
    hubspotHolds({ ...quiet, hs_sales_email_last_replied: '2026-10-24T16:00:00.000Z' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Whitfield replied on Oct 24, after this was proposed');
    expect(out?.keepOpen).toBeUndefined();
  });

  it('a reply from before the proposal is not news', async () => {
    hubspotHolds({ ...quiet, hs_sales_email_last_replied: '2026-10-01T16:00:00.000Z' });

    await expect(personalizationEnrollAction.stillHolds!(CTX, input, { ...basis, lastReplied: '2026-10-01T16:00:00.000Z' })).resolves.toBeNull();
  });

  it('booked a meeting after the proposal (epoch-millisecond stamp)', async () => {
    hubspotHolds({ ...quiet, hs_latest_meeting_activity: String(Date.parse('2026-10-26T15:00:00.000Z')) });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Whitfield booked a meeting since this was proposed (meeting on Oct 26)');
  });

  it('a meeting already on the books when proposed, dated in the future, is not news', async () => {
    const future = String(Date.parse('2026-11-12T15:00:00.000Z'));
    hubspotHolds({ ...quiet, hs_latest_meeting_activity: future });

    await expect(personalizationEnrollAction.stillHolds!(CTX, input, { ...basis, meeting: future })).resolves.toBeNull();
  });

  it('with no basis, a meeting date is not read as a booking', async () => {
    hubspotHolds({ ...quiet, hs_latest_meeting_activity: String(Date.parse('2026-11-12T15:00:00.000Z')) });

    await expect(personalizationEnrollAction.stillHolds!(CTX, input, null)).resolves.toBeNull();
  });

  it('the check and the enrollment derive the same code when the portal property is empty', async () => {
    hubspotHolds({ ...quiet, hs_sequences_is_enrolled: 'true', hs_latest_sequence_enrolled: null }, { sequenceId: '5501', sequenceName: 'Q4 Nurture' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.code).toBe('already_enrolled:5501');
  });

  it('advanced past the nurture band', async () => {
    hubspotHolds({ ...quiet, lifecyclestage: 'opportunity' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out).toMatchObject({
      line: 'Dana Whitfield\'s lifecycle stage moved from marketingqualifiedlead to opportunity since this was proposed',
      changed: [{ label: 'Lifecycle stage', from: 'marketingqualifiedlead', to: 'opportunity' }],
    });
  });

  it('unsubscribed', async () => {
    hubspotHolds({ ...quiet, hs_email_optout: 'true' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Whitfield unsubscribed from email since this was proposed');
  });

  it('was contacted by someone after the proposal', async () => {
    hubspotHolds({ ...quiet, notes_last_contacted: '2026-10-27T12:00:00.000Z' });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Whitfield was contacted on Oct 27, after this was proposed (HubSpot\'s last contacted)');
  });

  it('is now in an email thread that moved after the proposal', async () => {
    hubspotHolds(quiet);
    activeThreadWith.mockResolvedValue({ threadId: 't-7', subject: 'Re: Pilot timing', counterpart: 'dana@northbeam.example', lastMessageAt: '2026-10-28T09:30:00.000Z', messages: [] });
    const out = await personalizationEnrollAction.stillHolds!(CTX, input, basis);

    expect(out?.line).toBe('Dana Whitfield is now in an email thread, "Re: Pilot timing" on Oct 28; answer it there rather than enroll');
  });

  it('a HubSpot that cannot be read throws, which core reads as "still holds"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: 'down' }), text: async () => 'down' }) as unknown as Response));

    await expect(personalizationEnrollAction.stillHolds!(CTX, input, basis)).rejects.toThrow(/HubSpot contact read failed/);
  });
});
