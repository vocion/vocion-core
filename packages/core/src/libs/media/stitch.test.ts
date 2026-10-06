import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ffmpegBin, run } from './ffmpeg';
import { spokenMs } from './narration';
import { planStitch, STITCH_TAIL_MS, stitchEncoder, stitchTakes } from './stitch';

/**
 * ONE STORY, ONE VIDEO (Chris, 2026-10-05): a sender's tab and a visitor's tab, told in turns,
 * come out as one demo in the order the lines were said.
 */
const T0 = Date.parse('2026-10-05T03:09:00.000Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();

describe('the plan: which take shows when', () => {
  // The sender's tab ran the whole session; the visitor's opened 20 s in and ran to the end.
  const sender = { path: 'a.webm', startedAt: iso(0), endedAt: iso(60_000), script: [{ atMs: 2_000, text: 'I set the switch.' }, { atMs: 45_000, text: 'Back in my library it reads No download.' }], timeline: [{ atMs: 1_500, what: 'click switch' }, { atMs: 44_000, what: 'open /library' }] };
  const visitor = { path: 'b.webm', startedAt: iso(20_000), endedAt: iso(60_000), script: [{ atMs: 5_000, text: 'As the client, signed out, there is no Download button.' }], timeline: [{ atMs: 4_000, what: 'open /d/x as a visitor' }] };

  it('cuts each stretch from the take it was told in, a lead before its first line, in said order', () => {
    const plan = planStitch([sender, visitor], 1_500)!;

    expect(plan.segments).toEqual([
      { take: 0, fromMs: 0, toMs: 23_500 }, // the sender until 1.5 s before the visitor's line (said at 25 s)
      { take: 1, fromMs: 3_500, toMs: 23_500 }, // the visitor until 1.5 s before the sender's next line (said at 45 s)
      // The story ends a breath after its last line, not when the tab closed.
      { take: 0, fromMs: 43_500, toMs: 45_000 + spokenMs('Back in my library it reads No download.') + STITCH_TAIL_MS },
    ]);
    expect(plan.durationMs).toBe(45_000 + spokenMs('Back in my library it reads No download.') + STITCH_TAIL_MS);
    expect(plan.script).toEqual([
      { atMs: 2_000, text: 'I set the switch.' },
      { atMs: 25_000, text: 'As the client, signed out, there is no Download button.' },
      { atMs: 45_000, text: 'Back in my library it reads No download.' },
    ]);
    // Each take's moments land where that take was showing; the visitor's open is 1 s before its line.
    expect(plan.timeline.map(m => [m.atMs, m.what])).toEqual([[1_500, 'click switch'], [24_000, 'open /d/x as a visitor'], [44_000, 'open /library']]);
  });

  it('stitches nothing when one take told the whole story, or there is one take', () => {
    expect(planStitch([sender, { ...visitor, script: [] }])).toBeNull();
    expect(planStitch([sender])).toBeNull();
  });

  it('never starts a stretch before its take began, even with a long lead', () => {
    const plan = planStitch([sender, { ...visitor, script: [{ atMs: 500, text: 'Straight away.' }] }], 5_000)!;

    expect(plan.segments[1]).toEqual({ take: 1, fromMs: 0, toMs: 20_000 });
  });
});

describe('the cut', async () => {
  // CI's ffmpeg may be absent or built without libvpx; the cut is then refused with its reason, and the takes are kept.
  const encoder = await stitchEncoder();

  it('joins the segments into one video of the planned length', { timeout: 60_000, skip: encoder === null }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stitch-'));
    const a = join(dir, 'a.webm');
    const b = join(dir, 'b.webm');
    for (const [p, colour] of [[a, 'red'], [b, 'blue']] as const) {
      const r = await run(ffmpegBin(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=160x90:r=25:d=4`, '-c:v', encoder!, '-b:v', '200k', p], 30_000);

      expect(r.code, r.stderr).toBe(0);
    }
    const takes = [
      { path: a, startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 200, text: 'one' }, { atMs: 3_000, text: 'three' }] },
      { path: b, startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 1_500, text: 'two' }] },
    ];
    const plan = planStitch(takes, 300)!;
    const out = await stitchTakes(takes, plan, join(dir, 'out.webm'));

    expect(out).toEqual({ ok: true, path: join(dir, 'out.webm') });
    expect(existsSync(join(dir, 'out.webm')) && statSync(join(dir, 'out.webm')).size > 0).toBe(true);

    const probed = await run(ffmpegBin().replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'out.webm')], 30_000);

    expect(Math.abs(Number(probed.stdout.trim()) - plan.durationMs / 1000)).toBeLessThan(0.3);
  });

  it('refuses with its reason when this ffmpeg cannot write WebM, and the caller keeps the takes', async () => {
    expect(await stitchEncoder({ available: false, encoders: new Set() })).toBeNull();
    expect(await stitchEncoder({ available: true, encoders: new Set(['libx264']) })).toBeNull();
    expect(await stitchEncoder({ available: true, encoders: new Set(['libx264', 'libvpx-vp9']) })).toBe('libvpx-vp9');

    const plan = planStitch([{ path: 'x', startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 0, text: 'a' }] }, { path: 'y', startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 2_000, text: 'b' }] }])!;

    expect(await stitchTakes([{ path: 'x.webm', startedAt: iso(0), endedAt: iso(4_000), script: [] }, { path: 'y.webm', startedAt: iso(0), endedAt: iso(4_000), script: [] }], plan, '/nowhere/out.webm', { encoder: null })).toEqual({ ok: false, reason: 'the takes could not be stitched (this installation\'s ffmpeg cannot write WebM: no libvpx encoder)' });
  });

  it('says why when ffmpeg refuses', async () => {
    const plan = planStitch([{ path: 'x', startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 0, text: 'a' }] }, { path: 'y', startedAt: iso(0), endedAt: iso(4_000), script: [{ atMs: 2_000, text: 'b' }] }])!;

    const takes = [{ path: 'x.webm', startedAt: iso(0), endedAt: iso(4_000), script: [] }, { path: 'y.webm', startedAt: iso(0), endedAt: iso(4_000), script: [] }];

    expect(await stitchTakes(takes, plan, '/nowhere/out.webm', { encoder: 'libvpx', run: async () => ({ code: 1, stdout: '', stderr: 'No such file', error: null }) })).toEqual({ ok: false, reason: 'the takes could not be stitched (No such file)' });
    expect(await stitchTakes([], plan, '/nowhere/out.webm')).toMatchObject({ ok: false });
  });
});

describe('the end of a stitched story', () => {
  it('ends a breath after the last line, not when the tab closed', async () => {
    const { planStitch, STITCH_TAIL_MS } = await import('./stitch');
    const { spokenMs } = await import('./narration');
    const iso2 = (ms: number) => new Date(Date.parse('2026-10-05T03:09:00.000Z') + ms).toISOString();
    const plan = planStitch([
      { path: 'a.webm', startedAt: iso2(0), endedAt: iso2(600_000), script: [{ atMs: 1_000, text: 'One.' }, { atMs: 30_000, text: 'Three.' }] },
      { path: 'b.webm', startedAt: iso2(10_000), endedAt: iso2(600_000), script: [{ atMs: 5_000, text: 'Two.' }] },
    ], 1_500)!;

    expect(plan.segments.at(-1)).toEqual({ take: 0, fromMs: 28_500, toMs: 30_000 + spokenMs('Three.') + STITCH_TAIL_MS });
  });
});
