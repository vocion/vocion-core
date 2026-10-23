import { describe, expect, it } from 'vitest';
import { captureOf, externalOf, isSettled, mayBeExternal, meetingKey, NOTE_SETTLE_MS, transcriptReadyPayload } from './captures';

const NOW = new Date('2026-10-23T18:00:00.000Z');

describe('a meeting capture, from metadata only', () => {
  it('reads a note: its owner, its people, and who is outside', () => {
    const c = captureOf({
      id: 11,
      externalId: 'granola:n1',
      title: 'Northwind intro — 2026-10-23T17:30:00Z',
      metadata: { kind: 'granola-note', owner: 'Sam@Vocion.example', when: '2026-10-23T17:30:00Z', attendees: ['sam@vocion.example', 'Dana Reyes <dana@northwind.example>', 'room-1@resource.calendar.google.com'], hasTranscript: true },
      lastModifiedAt: new Date(NOW.getTime() - 20 * 60_000),
    })!;

    expect(c).toMatchObject({ documentId: 11, externalId: 'granola:n1', connector: 'granola', owner: 'sam@vocion.example', start: '2026-10-23T17:30:00Z', external: ['dana@northwind.example'] });
    expect(c.attendees).toEqual(['sam@vocion.example', 'dana@northwind.example']);
    expect(transcriptReadyPayload(c)).toMatchObject({ documentId: 11, externalAttendees: 'dana@northwind.example', externalCount: 1 });
  });

  it('gives an attendee-less recording its people from the calendar event with the same Zoom id', () => {
    const c = captureOf(
      { id: 12, title: 'Kestrel proposal review', metadata: { kind: 'zoom-recording', host: 'sam@vocion.example', meetingId: 987, start: '2026-10-22T20:00:00Z', hasTranscript: true }, lastModifiedAt: null },
      id => (id === '987' ? { attendees: ['sam@vocion.example', 'lee@kestrelcapital.example'], organizer: 'sam@vocion.example' } : null),
    )!;

    expect(c.external).toEqual(['lee@kestrelcapital.example']);
  });

  it('is not a capture when the document is not a meeting', () => {
    expect(captureOf({ id: 13, title: 'Thread', metadata: { kind: 'gmail-thread' }, lastModifiedAt: null })).toBeNull();
  });

  it('calls nobody external without an owner to compare against', () => {
    expect(externalOf(null, ['a@northwind.example'])).toEqual([]);
  });
});

describe('settled — never followed up off half a meeting', () => {
  const note = (changedAgoMs: number) => captureOf({ id: 1, title: 'x', metadata: { kind: 'granola-note', owner: 'sam@vocion.example' }, lastModifiedAt: new Date(NOW.getTime() - changedAgoMs) })!;

  it('a note settles once it stops changing', () => {
    expect(isSettled(note(NOTE_SETTLE_MS - 1), NOW)).toBe(false);
    expect(isSettled(note(NOTE_SETTLE_MS), NOW)).toBe(true);
  });

  it('a recording settles once its transcript is in', () => {
    const rec = (hasTranscript: boolean) => captureOf({ id: 2, title: 'x', metadata: { kind: 'zoom-recording', host: 'sam@vocion.example', hasTranscript }, lastModifiedAt: null })!;

    expect(isSettled(rec(false), NOW)).toBe(false);
    expect(isSettled(rec(true), NOW)).toBe(true);
  });

  it('only a capture that lists its people and lists nobody outside is known internal', () => {
    expect(mayBeExternal(captureOf({ id: 3, title: 'standup', metadata: { kind: 'granola-note', owner: 'sam@vocion.example', attendees: ['ana@vocion.example'] }, lastModifiedAt: null })!)).toBe(false);
    expect(mayBeExternal(captureOf({ id: 4, title: 'call', metadata: { kind: 'granola-note', owner: 'sam@vocion.example' }, lastModifiedAt: null })!)).toBe(true);
  });
});

describe('one meeting, two captures', () => {
  it('a recording and a note of the same call share a key; a capture with no owner or start is its own', () => {
    const a = meetingKey({ documentId: 1, owner: 'sam@vocion.example', start: '2026-10-22T20:00:00Z' });
    const b = meetingKey({ documentId: 2, owner: 'sam@vocion.example', start: '2026-10-22T20:02:41Z' });

    expect(a).toBe(b);
    expect(meetingKey({ documentId: 3, owner: null, start: '2026-10-22T20:00:00Z' })).toBe('doc:3');
  });
});
