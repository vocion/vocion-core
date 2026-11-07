import type { RoutineFound } from '@/libs/routines/types';
import type { SlateFetch } from '@/libs/slate/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findingMarks, findingsOf } from '@/libs/routines/findings';
import { readSlateRecording, slatePlayableUrl } from '@/libs/slate/recording';
import { FIXTURE_ACTIVITY, FIXTURE_ANALYST_REPLY, FIXTURE_LINK, FIXTURE_TRANSCRIPT, FIXTURE_VIDEO } from './fixtures/teachRecording';

/**
 * TEACHING, LIVE — a recording read from Slate (a recorded fixture of its MCP
 * answers) and drafted by an analyst whose reply streams in pieces: what it
 * finds is handed on as it is found, in order, each finding whole, and the last
 * hand-off is everything the finished spec holds.
 */

const fakeModel = vi.hoisted(() => ({ reply: '', pieces: 40 }));

vi.mock('@/libs/llm', () => ({
  buildChatModelForOrg: async () => ({
    invoke: async () => ({ content: fakeModel.reply }),
    stream: async () => (async function* () {
      const size = Math.ceil(fakeModel.reply.length / fakeModel.pieces);
      for (let i = 0; i < fakeModel.reply.length; i += size) {
        const content = fakeModel.reply.slice(i, i + size);
        yield { content, concat: (o: { content: string }) => ({ content: content + o.content }) };
      }
    })(),
  }),
}));
vi.mock('@/services/budget/chargeModelCall', () => ({ chargeModelCall: async () => {} }));

const { draftSpec, foundSoFar } = await import('./teaching');

/**
 * Slate's MCP, answering every tool with the recorded fixture.
 * @param url
 * @param init
 */
const slate: SlateFetch = async (url, init) => {
  const body = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { name?: string } };
  const text = body.method === 'initialize'
    ? JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } })
    : body.method === 'tools/call'
      ? JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: { get_video: FIXTURE_VIDEO, get_transcript: FIXTURE_TRANSCRIPT, get_activity: FIXTURE_ACTIVITY }[body.params?.name ?? ''] ?? '' }] } })
      : '';
  void url;
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) } };
};
const CREDS = { token: 'slt_fixture_token_0002', apiBase: 'https://api.video-host.example' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the analyst has found so far', () => {
  it('keeps only findings it has finished writing', () => {
    const cut = FIXTURE_ANALYST_REPLY.indexOf('"Choose Hospital');
    const found = foundSoFar(FIXTURE_ANALYST_REPLY.slice(0, cut));

    // Both sites are closed (steps began after them); steps 1–4 are whole, step 5 is being written.
    expect(found.sites.map(s => s.name)).toEqual(['State license lookup', 'Larkspur Health Plan provider pages']);
    expect(found.steps.map(s => s.n)).toEqual([1, 2, 3, 4]);
    expect(found.rules).toEqual([]);
    expect(found.questions).toEqual([]);
  });

  it('reads nothing from a reply that has not begun its object, and everything from a whole one', () => {
    expect(foundSoFar('Here is the spec')).toEqual({ sites: [], steps: [], rules: [], judgments: [], questions: [] });

    const all = foundSoFar(FIXTURE_ANALYST_REPLY);

    expect(all.steps).toHaveLength(6);
    expect(all.judgments).toHaveLength(2);
    expect(all.questions[0]).toMatchObject({ id: 'q1', at: 31 });
  });
});

describe('teaching from a recording, live', () => {
  it('hands on findings as they are found, in order, ending with the whole spec', async () => {
    const read = await readSlateRecording(CREDS, FIXTURE_LINK, slate);

    expect(read.ok).toBe(true);

    const rec = read.ok ? read.data : null!;

    expect(rec.video.durationSec).toBe(595.5);
    expect(rec.transcript).toHaveLength(18);
    expect(rec.transcript[5]).toEqual({ at: 44, text: 'So if you can see the sample here [provider name], her license is um active.' });

    // Each piece of the reply is a tick past the hand-off interval.
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));
    fakeModel.reply = FIXTURE_ANALYST_REPLY;
    const heard: RoutineFound[] = [];
    const drafted = await draftSpec('org-fixture', rec, [], { name: null }, f => heard.push(f));

    // Many hand-offs, not one block at the end.
    expect(heard.length).toBeGreaterThan(5);

    // Each one holds everything the one before did, and the steps arrive in order.
    for (let i = 1; i < heard.length; i += 1) {
      expect(findingsOf(heard[i]).length).toBeGreaterThan(findingsOf(heard[i - 1]).length);
      expect(heard[i]!.steps.slice(0, heard[i - 1]!.steps.length)).toEqual(heard[i - 1]!.steps);
    }

    expect(heard.some(f => f.steps.length > 0 && f.questions.length === 0)).toBe(true);

    // The last is what the draft holds.
    const last = heard.at(-1)!;

    expect(last.steps).toEqual(drafted.spec.steps);
    expect(last.rules).toEqual(drafted.spec.rules);
    expect(last.judgments).toEqual(drafted.spec.judgments);
    expect(last.sites).toEqual(drafted.spec.sites);
    expect(last.questions.map(q => q.question)).toEqual(drafted.spec.questions.filter(q => q.id !== 'start').map(q => q.question));
  });

  it('draws the finished spec as findings on the recording\'s track', async () => {
    fakeModel.reply = FIXTURE_ANALYST_REPLY;
    const read = await readSlateRecording(CREDS, FIXTURE_LINK, slate);
    const { spec } = await draftSpec('org-fixture', read.ok ? read.data : null!, [], {});
    const marks = findingMarks(findingsOf(spec), 595.5);

    expect(marks.map(m => m.at)).toEqual([...marks.map(m => m.at)].sort((a, b) => a - b));
    expect(new Set(marks.map(m => m.kind))).toEqual(new Set(['step', 'system', 'rule', 'judgment', 'question']));
    expect(marks.find(m => m.id === 'step-5')).toMatchObject({ at: 109, label: 'Step 5: Choose Hospital and other providers' });
    // The start-address question has no moment, so no mark.
    expect(marks.some(m => m.id === 'question-start')).toBe(false);
  });
});

describe('the recording\'s player', () => {
  it('is handed the file Slate\'s download link redirects to', async () => {
    const doFetch: SlateFetch = async (url, init) => {
      if (init.method === 'HEAD') {
        expect(init.redirect).toBe('manual');

        return { ok: false, status: 302, json: async () => null, text: async () => '', headers: { get: (n: string) => (n.toLowerCase() === 'location' ? 'https://files.video-host.example/fixture/video.mp4?sig=1' : null) } };
      }
      return slate(url, init);
    };
    const r = await slatePlayableUrl(CREDS, FIXTURE_LINK, doFetch);

    expect(r).toEqual({ ok: true, data: 'https://files.video-host.example/fixture/video.mp4?sig=1' });
  });

  it('says so when Slate gives no link to play', async () => {
    const bare: SlateFetch = async (url, init) => {
      const res = await slate(url, init);
      const text = (await res.text()).replace(/\\"downloadUrl\\": \\"[^"\\]*\\",?/, '');
      return { ...res, text: async () => text, json: async () => JSON.parse(text) };
    };
    const r = await slatePlayableUrl(CREDS, FIXTURE_LINK, bare);

    expect(r.ok).toBe(false);
  });
});
