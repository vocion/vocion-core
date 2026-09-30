import type { ReportArtifact, ReportObject, ReportWorkerRun } from './featureReport';
import { describe, expect, it } from 'vitest';
import { captionOf, CAROUSEL_SECTIONS, pageLabel, runOfCapture, shortDate, sourceOf } from './carouselSource';

const T = (iso: string) => new Date(iso);

function art(over: Partial<ReportArtifact>): ReportArtifact {
  return { id: 620, kind: 'file', title: 'Mockup: Remind who has not opened it · Default', recordType: 'object', recordId: '41', recordRole: 'mockup', spec: {}, url: null, createdAt: T('2026-09-25T14:00:00Z'), ...over };
}

const run = { id: 435, input: { record: { type: 'engineering_task', id: 77 } }, createdAt: T('2026-09-26T09:00:00Z'), completedAt: T('2026-09-26T09:40:00Z') } as unknown as ReportWorkerRun;
const release = { id: 88, title: 'Rooms 3.2', status: null, createdAt: T('2026-09-27T10:00:00Z'), meta: { version: '3.2.0' } } as ReportObject;

describe('every carousel picture says what it is and who made it', () => {
  it('reads a caption written at filing, then the state, then the title', () => {
    expect(captionOf(art({ spec: { caption: 'Remind a person who has not opened it', source: { state: 'Default' } } }))).toBe('Remind a person who has not opened it');
    expect(captionOf(art({ spec: { source: { state: 'Reminder sent' } } }))).toBe('Reminder sent');
    expect(captionOf(art({}))).toBe('Mockup: Remind who has not opened it · Default');
  });

  it('a mockup: who drew it, from what, when — linked to the run it was drawn in', () => {
    const mockup = art({ author: 'Designer', spec: { source: { state: 'Default' }, provenance: { drawnFrom: 'request', missionRunId: 5120 } } });

    expect(sourceOf({ artifact: mockup, section: CAROUSEL_SECTIONS.mockup, runs: [], releases: [] })).toEqual({ text: 'Designer · drawn from the request · Sep 25', ref: { type: 'mission_run', id: '5120' } });

    const onScreen = art({ author: 'Designer', conversationId: 397, spec: { provenance: { drawnFrom: 'screen', baseArtifactId: 611 } } });

    expect(sourceOf({ artifact: onScreen, section: CAROUSEL_SECTIONS.mockup, runs: [], releases: [] })).toEqual({ text: 'Designer · drawn on screenshot #611 · Sep 25', ref: { type: 'conversation', id: '397' } });
  });

  it('a QA capture: the run it came from and its side', () => {
    const shot = art({ id: 700, recordRole: 'qa-screenshot', recordId: '77', title: 'Rooms · desktop · after', createdAt: T('2026-09-26T09:30:00Z') });

    expect(runOfCapture(shot, [run])).toBe(435);
    expect(sourceOf({ artifact: shot, section: CAROUSEL_SECTIONS.qaAfter, runs: [run], releases: [] })).toEqual({ text: 'QA · run 435 · after · Sep 26', ref: { type: 'worker_run', id: '435' } });
    // A run it names wins; one on another record is never claimed.
    expect(runOfCapture(art({ recordId: '77', spec: { provenance: { workerRunId: 436 } } }), [run])).toBe(436);
    expect(runOfCapture(art({ recordId: '78', createdAt: T('2026-09-26T09:30:00Z') }), [run])).toBeNull();
  });

  it('a live capture names the page; a shipped one names its release', () => {
    const live = art({ id: 611, recordRole: 'before-shot', spec: { capturedFrom: 'https://app.northwind.example/settings?tab=links' } });

    expect(sourceOf({ artifact: live, section: CAROUSEL_SECTIONS.today, runs: [], releases: [] }).text).toBe('Live app capture · app.northwind.example/settings · Sep 25');
    expect(sourceOf({ artifact: art({ id: 812, recordRole: null, author: 'Designer' }), section: CAROUSEL_SECTIONS.live, runs: [], releases: [release] })).toEqual({ text: 'Captured by Designer · release 3.2.0 · Sep 25', ref: { type: 'object', id: '88' } });
  });

  it('a picture sent in chat: the person and the conversation', () => {
    const sent = art({ id: 901, recordRole: 'reported', author: 'Dana Okafor', conversationId: 397 });

    expect(sourceOf({ artifact: sent, section: CAROUSEL_SECTIONS.reported, runs: [], releases: [] })).toEqual({ text: 'Reported in chat by Dana Okafor · conversation 397 · Sep 25', ref: { type: 'conversation', id: '397' } });
  });

  it('the platform\'s own drawing of the record is the plan picture', () => {
    expect(sourceOf({ artifact: art({ recordRole: 'proposal-visual', author: 'Vocion' }), section: CAROUSEL_SECTIONS.plan, runs: [], releases: [] }).text).toBe('Vocion · drawn from the record · Sep 25');
  });

  it('dates and pages read the way a person says them', () => {
    expect(shortDate(T('2026-09-05T23:59:00Z'))).toBe('Sep 5');
    expect(pageLabel('https://www.northwind.example/')).toBe('northwind.example');
  });
});
