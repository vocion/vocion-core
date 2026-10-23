import { describe, expect, it } from 'vitest';
import { meetingFollowupAction, meetingFollowupCard, meetingName } from './meeting-followup';
import { NEVER_AUTO_ACTION_IDS } from './neverAuto';

const input = meetingFollowupAction.inputSchema.parse({
  documentId: 41,
  externalId: 'granola:n41',
  meetingKey: 'sam@vocion.example:2026-10-22T20:00:00.000Z',
  title: 'Northwind proposal review — 2026-10-22T20:00:00Z',
  start: '2026-10-22T20:00:00Z',
  externalAttendees: 'dana@northwind.example',
  counterpart: 'client',
  why: 'Dana asked for the revised scope by Friday.',
  roomId: 98,
  roomTitle: 'Northwind',
  deckArtifactId: 501,
  deckTitle: 'Northwind proposal',
  nextMeetingTitle: 'Demo',
  nextMeetingStart: '2026-10-27T17:00:00Z',
});

describe('meeting.draft_followup — one card per call', () => {
  it('asks to draft, says who it goes to, what it attaches and what is next', () => {
    const card = meetingFollowupCard(input);

    expect(card.title).toBe('Approve to draft the Northwind proposal review follow-up');
    expect(card.verbs).toEqual({ approve: 'Draft the follow-up', reject: 'No follow-up' });
    expect(card.nextAction).toContain('dana@northwind.example');
    expect(card.nextAction).toContain('Northwind proposal attached as a PDF');
    expect(card.nextAction).toContain('Nothing is sent');
    expect(card.fields?.map(f => f.label)).toEqual(['Meeting', 'When', 'To', 'Data room', 'Attach', 'Next on the calendar']);
  });

  it('is one item per meeting, and only a person releases it', () => {
    expect(meetingFollowupAction.ownsDedupKey).toBe(true);
    expect(meetingFollowupAction.dedupKeyFor!(input)).toBe('meeting.draft_followup:sam@vocion.example:2026-10-22T20:00:00.000Z');
    expect(NEVER_AUTO_ACTION_IDS.has('meeting.draft_followup')).toBe(true);
  });

  it('names the meeting without the time a note-taker appends', () => {
    expect(meetingName({ title: 'Kestrel intro — 2026-10-23T17:30:00Z' })).toBe('Kestrel intro');
    expect(meetingName({ title: '' })).toBe('your call');
  });
});
