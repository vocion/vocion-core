import type { MeetingFollowupDeps, MeetingRead } from './meetingFollowup';
import type { MeetingCapture } from '@/services/meetings/captures';
import { describe, expect, it, vi } from 'vitest';
import { followUpOwed, runMeetingFollowupJob } from './meetingFollowup';

const ORG = 'org_meetings';

function capture(over: Partial<MeetingCapture> = {}): MeetingCapture {
  return {
    documentId: 41,
    externalId: 'granola:n41',
    connector: 'granola',
    title: 'Northwind proposal review',
    start: '2026-10-22T20:00:00Z',
    owner: 'sam@vocion.example',
    attendees: ['sam@vocion.example', 'dana@northwind.example'],
    external: ['dana@northwind.example'],
    hasTranscript: true,
    changedAt: null,
    ...over,
  };
}

const OWED: MeetingRead = { counterpart: 'client', followUpOwed: true, why: 'Dana asked for the revised scope by Friday.' };

function deps(over: Partial<MeetingFollowupDeps> = {}) {
  const emitted: Array<{ type: string; payload: Record<string, unknown>; key: string }> = [];
  const d: MeetingFollowupDeps = {
    capture: vi.fn(async () => capture()),
    handled: vi.fn(async () => ({ card: null, discoveryPending: [], discoveryApproved: null })),
    text: vi.fn(async () => 'Dana: we need the revised scope by Friday.'),
    read: vi.fn(async () => OWED),
    context: vi.fn(async () => ({ room: { id: 98, title: 'Northwind' }, deck: { id: 501, title: 'Northwind proposal' }, document: null, nextMeeting: { title: 'Demo', start: '2026-10-27T17:00:00Z' } })),
    file: vi.fn(async () => ({ runId: 700, outcome: 'created' })),
    supersede: vi.fn(async () => {}),
    emit: vi.fn(async (_o, type, payload, key) => {
      emitted.push({ type, payload, key });
      return { deduped: false, runIds: type === 'meeting.followup_owed' ? [9001] : [], skipped: [] };
    }),
    drafts: vi.fn(async () => [{ id: 800, to: 'Dana Reyes <dana@northwind.example>', subject: 'Re: revised scope', attachments: 1 }]),
    ...over,
  };
  return { d, emitted };
}

describe('triage — one card per client call', () => {
  it('files the follow-up card with the room, the deck and the next meeting, and tells its owner', async () => {
    const { d, emitted } = deps();
    const res = await runMeetingFollowupJob(ORG, { documentId: 41, phase: 'triage', agent: 'followup-writer' }, d);

    expect(res).toMatchObject({ outcome: 'awaiting', actionRunId: 700 });
    expect(d.file).toHaveBeenCalledWith(ORG, expect.objectContaining({
      documentId: 41,
      externalId: 'granola:n41',
      externalAttendees: 'dana@northwind.example',
      roomId: 98,
      deckArtifactId: 501,
      nextMeetingTitle: 'Demo',
      counterpart: 'client',
    }), OWED, 'followup-writer');
    expect(emitted.map(e => e.type)).toEqual(['meeting.followup_awaiting']);
    expect(emitted[0]!.payload).toMatchObject({ owner: 'sam@vocion.example', link: '/dashboard/inbox/proposal-700', meetingTitle: 'Northwind proposal review' });
    // Nothing is drafted before a person releases the call.
    expect(d.drafts).not.toHaveBeenCalled();
  });

  it('never reads an all-internal call', async () => {
    const { d } = deps({ capture: vi.fn(async () => capture({ attendees: ['sam@vocion.example', 'ana@vocion.example'], external: [] })) });

    expect(await runMeetingFollowupJob(ORG, { documentId: 41 }, d)).toMatchObject({ outcome: 'skipped', reason: 'internal' });
    expect(d.text).not.toHaveBeenCalled();
    expect(d.read).not.toHaveBeenCalled();
  });

  it('routes on the typed read: a vendor call, or one where nothing is owed, files nothing', async () => {
    for (const read of [{ counterpart: 'vendor', followUpOwed: true, why: 'x' }, { counterpart: 'prospect', followUpOwed: false, why: 'x' }] as MeetingRead[]) {
      const { d } = deps({ read: vi.fn(async () => read) });

      expect(await runMeetingFollowupJob(ORG, { documentId: 41 }, d)).toMatchObject({ outcome: 'skipped', reason: 'not-owed' });
      expect(d.file).not.toHaveBeenCalled();
    }

    expect(followUpOwed({ counterpart: 'prospect', followUpOwed: true, why: '' })).toBe(true);
  });

  it('a meeting already carded — this capture or its twin — is not carded again', async () => {
    const { d } = deps({ handled: vi.fn(async () => ({ card: 650, discoveryPending: [], discoveryApproved: null })) });

    expect(await runMeetingFollowupJob(ORG, { documentId: 41 }, d)).toMatchObject({ outcome: 'skipped', reason: 'already-carded' });
    expect(d.read).not.toHaveBeenCalled();
  });

  it('closes a waiting discovery card for the same call in the follow-up card\'s favour', async () => {
    const { d } = deps({ handled: vi.fn(async () => ({ card: null, discoveryPending: [612], discoveryApproved: null })) });
    const res = await runMeetingFollowupJob(ORG, { documentId: 41 }, d);

    expect(res).toMatchObject({ outcome: 'awaiting', superseded: [612] });
    expect(d.supersede).toHaveBeenCalledWith(ORG, [612], 700);
  });

  it('a call a person already released on its discovery card is drafted from that approval, with no second card', async () => {
    const { d, emitted } = deps({
      handled: vi.fn(async () => ({ card: null, discoveryPending: [], discoveryApproved: { runId: 9352, missionRunId: 5000, documentId: 40 } })),
      // The approval's own run drafted nothing (its transcript read was refused).
      drafts: vi.fn(async (_o: string, ids: number[]) => (ids.includes(5000) ? [] : [{ id: 801, to: 'dana@northwind.example', subject: 'Re: scope', attachments: 1 }])),
    });
    const res = await runMeetingFollowupJob(ORG, { documentId: 41 }, d);

    expect(res).toMatchObject({ outcome: 'drafted', proposals: [801] });
    expect(d.file).not.toHaveBeenCalled();
    expect(emitted.map(e => e.type)).toEqual(['meeting.followup_owed', 'meeting.followup_ready']);
    expect(emitted[0]!.payload).toMatchObject({ documentId: 40, approvalRunId: 9352, deckArtifactId: 501 });
  });

  it('a discovery approval that already drafted the follow-up is left alone', async () => {
    const { d } = deps({ handled: vi.fn(async () => ({ card: null, discoveryPending: [], discoveryApproved: { runId: 9352, missionRunId: 5000, documentId: 40 } })) });

    expect(await runMeetingFollowupJob(ORG, { documentId: 41 }, d)).toMatchObject({ outcome: 'skipped', reason: 'discovery-approved' });
  });

  it('an unread meeting fails the fire rather than reading as nothing owed', async () => {
    const { d } = deps({ read: vi.fn(async () => null) });

    await expect(runMeetingFollowupJob(ORG, { documentId: 41 }, d)).rejects.toThrow(/could not read/);
  });
});

describe('draft — the approval starts it, and the owner hears when it is ready', () => {
  const approved = { phase: 'draft', documentId: 41, approvalRunId: 700, meetingKey: 'k', title: 'Northwind proposal review', owner: 'sam@vocion.example', roomId: 98, deckArtifactId: 501 };

  it('raises the owed event for the writer, finds what its run proposed, and tells the owner', async () => {
    const { d, emitted } = deps();
    const res = await runMeetingFollowupJob(ORG, approved, d);

    expect(res).toMatchObject({ outcome: 'drafted', proposals: [800] });
    expect(emitted[0]).toMatchObject({ type: 'meeting.followup_owed', key: 'meeting.followup_owed:700' });
    expect(emitted[0]!.payload).not.toHaveProperty('phase');
    expect(d.drafts).toHaveBeenCalledWith(ORG, [9001]);
    expect(emitted[1]).toMatchObject({ type: 'meeting.followup_ready', key: 'meeting.followup_ready:800' });
    expect(emitted[1]!.payload).toMatchObject({ owner: 'sam@vocion.example', link: '/dashboard/inbox/proposal-800', attachments: 1 });
  });

  it('says why when no draft landed', async () => {
    const { d } = deps({ drafts: vi.fn(async () => []) });

    expect(await runMeetingFollowupJob(ORG, approved, d)).toMatchObject({ outcome: 'no-draft', detail: expect.stringContaining('#9001 proposed no email') });
  });

  it('a second fire of the same approval drafts nothing twice', async () => {
    const { d } = deps({ emit: vi.fn(async () => ({ deduped: true, runIds: [], skipped: [] })) });

    expect(await runMeetingFollowupJob(ORG, approved, d)).toMatchObject({ outcome: 'skipped', reason: 'already-drafted' });
  });
});
