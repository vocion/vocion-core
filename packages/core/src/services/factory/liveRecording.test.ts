import { describe, expect, it } from 'vitest';
import { spokenMs } from '@/libs/media/narration';
import { scriptOf } from './liveBrowser';
import { demoRecordingCaption, demoScript, liveRecordingCaption } from './liveRecording';

describe('what a recording is called', () => {
  it('a check reads the release and the day; a demo reads the request and the day, the viewport only when there are two', () => {
    const at = new Date('2026-10-04T13:05:00Z');

    expect(liveRecordingCaption('REL-427', 9, at, null)).toBe('Live check of REL-427, 2026-10-04');
    expect(demoRecordingCaption('FE-419', 12, at, null)).toBe('Feature demo of FE-419, 2026-10-04');
    expect(demoRecordingCaption(null, 12, at, 'phone')).toBe('Feature demo of request #12, 2026-10-04 · phone');
  });
});

describe('the demo\'s script (2026-10-04)', () => {
  it('is what QA said in the demo tab while its video ran, at each line\'s moment from the start, in order', () => {
    const said = (id: string, at: string, text: string, tab: string) => ({ id, kind: 'said' as const, at, text, tab });
    const evidence = [
      { id: 'act-1', kind: 'action' as const, at: '2026-10-04T13:00:01.000Z', what: 'open /library', ok: true, detail: null, url: null },
      said('said-1', '2026-10-04T13:00:01.500Z', 'I open the library.', 'demo:12|web|desktop|in'),
      said('said-2', '2026-10-04T13:00:00.200Z', 'Said in the check tab.', 'web|desktop|in'),
      said('said-3', '2026-10-04T13:00:09.000Z', 'I pick Share.', 'demo:12|web|desktop|in'),
      said('said-4', '2026-10-04T12:59:59.000Z', 'Said before the video started.', 'demo:12|web|desktop|in'),
      said('said-5', '2026-10-04T13:00:40.000Z', 'Said after it ended.', 'demo:12|web|desktop|in'),
    ];

    expect(scriptOf(evidence, 'demo:12|web|desktop|in', '2026-10-04T13:00:00.000Z', '2026-10-04T13:00:30.000Z')).toEqual([
      { atMs: 1500, text: 'I open the library.' },
      { atMs: 9000, text: 'I pick Share.' },
    ]);
  });

  it('gives each line the time it takes to say, so the narration is placed where the screen held', () => {
    const lines = demoScript([{ atMs: 1500.4, text: 'I open the library.' }, { atMs: 9000, text: 'I pick Share and set the address to q3-board-deck, then copy the link.' }]);

    expect(lines[0]).toEqual({ atMs: 1500, endMs: 1500 + spokenMs('I open the library.'), text: 'I open the library.' });
    expect(lines[1]!.endMs - lines[1]!.atMs).toBeGreaterThan(lines[0]!.endMs - lines[0]!.atMs);
  });
});

describe('how long a line holds the screen', () => {
  it('is never shorter than a glance nor longer than a breath, and grows with the words', () => {
    expect(spokenMs('Done.')).toBe(1400);
    expect(spokenMs('I open the document and pick Share from the menu.')).toBeGreaterThan(1400);
    expect(spokenMs('x'.repeat(2000))).toBe(12_000);
  });
});
