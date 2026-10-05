import type { SessionRecording } from './liveBrowser';
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

describe('one story, one video (Chris, 2026-10-05)', () => {
  const T0 = Date.parse('2026-10-05T03:09:00.000Z');
  const iso = (ms: number) => new Date(T0 + ms).toISOString();
  const take = (over: Partial<SessionRecording>): SessionRecording => ({ path: '/tmp/a.webm', viewport: 'desktop', signedIn: true, env: 'production', startedAt: iso(0), endedAt: iso(60_000), timeline: [], purpose: 'demo', requestId: 453, script: [], ...over });

  it('stitches the takes of one request and viewport into one demo in said order, and says so in the provenance', async () => {
    const sender = take({ path: '/tmp/sender.webm', script: [{ atMs: 2_000, text: 'I set the switch.' }, { atMs: 45_000, text: 'Back in my library.' }] });
    const visitor = take({ path: '/tmp/visitor.webm', signedIn: false, startedAt: iso(20_000), script: [{ atMs: 5_000, text: 'As the client, signed out.' }] });
    const stitched: string[] = [];
    const { mergeDemoTakes } = await import('./liveRecording');
    const out = await mergeDemoTakes([visitor, sender], async (takes, plan, path) => {
      stitched.push(`${takes.length} takes, ${plan.segments.length} segments -> ${path}`);
      return { ok: true, path };
    });

    expect(stitched).toEqual(['2 takes, 3 segments -> /tmp/sender-story.webm']);
    expect(out.refused).toEqual([]);
    expect(out.takes).toHaveLength(1);
    // The story ends a breath after its last line (45 s), not when the tabs closed (60 s).
    expect(out.takes[0]).toMatchObject({ path: '/tmp/sender-story.webm', tabs: 2, requestId: 453, startedAt: iso(0) });
    expect(Date.parse(out.takes[0]!.endedAt)).toBeLessThan(Date.parse(iso(60_000)));
    expect(out.takes[0]!.script.map(l => l.text)).toEqual(['I set the switch.', 'As the client, signed out.', 'Back in my library.']);
  });

  it('keeps the takes as they were when there is one, when only one spoke, or when the cut failed', async () => {
    const { mergeDemoTakes } = await import('./liveRecording');
    const one = take({ script: [{ atMs: 1, text: 'x' }] });
    const other = take({ path: '/tmp/b.webm', requestId: 99, script: [{ atMs: 1, text: 'y' }] });

    expect((await mergeDemoTakes([one, other])).takes.map(t => [t.path, t.tabs])).toEqual([['/tmp/a.webm', 1], ['/tmp/b.webm', 1]]);

    const silent = take({ path: '/tmp/quiet.webm', startedAt: iso(10_000) });

    expect((await mergeDemoTakes([one, silent])).takes).toHaveLength(2);

    const failed = await mergeDemoTakes([one, take({ path: '/tmp/c.webm', startedAt: iso(10_000), script: [{ atMs: 1_000, text: 'z' }] })], async () => ({ ok: false, reason: 'ffmpeg is not installed' }));

    expect(failed.takes).toHaveLength(2);
    expect(failed.refused).toEqual(['the desktop demo of request #453 was kept as 2 takes: ffmpeg is not installed']);
  });
});
