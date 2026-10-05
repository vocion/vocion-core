/**
 * ONE STORY, ONE VIDEO (Chris, 2026-10-05, on FE-453: "The before merge shows the account
 * owner and uploaded view. The live view shows the recipient flow. That's confusing."). A demo
 * that shows the recipient has to open the link signed out, and a signed-out view needs its own
 * browser context, which records its own video. So one story told across a sender's tab and a
 * visitor's tab came out as two demos, and the page led with whichever was narrated last.
 *
 * The session knows the order the lines were said across tabs. This stitches the tabs' takes
 * into one video in that order: each stretch of the story is cut from the take it was told in,
 * starting a little before its first line so the move into that tab is seen, and the said lines
 * are placed on the stitched clock. The plan is pure; the cut is one ffmpeg run.
 */
import { ffmpegBin, ffmpegCapabilities, run } from './ffmpeg';

/** One tab's recording, as the session set it aside. */
export type Take = {
  /** Where the video is. */
  path: string;
  startedAt: string;
  endedAt: string;
  /** What was said in this tab, each line at its moment from this video's start. */
  script: ReadonlyArray<{ atMs: number; text: string }>;
  /** What happened while this video ran, each at its moment from this video's start. */
  timeline?: ReadonlyArray<{ atMs: number } & Record<string, unknown>>;
};

/** A stretch of the stitched video: which take it is cut from and where. */
export type Segment = { take: number; fromMs: number; toMs: number };

export type StitchPlan = {
  segments: Segment[];
  /** The said lines on the stitched clock, in order. */
  script: Array<{ atMs: number; text: string }>;
  /** The moments on the stitched clock, each from the take that was showing. */
  timeline: Array<{ atMs: number } & Record<string, unknown>>;
  durationMs: number;
};

/** The WebM encoders this can write with, in order of preference; a Playwright take is VP8 WebM. */
export const STITCH_ENCODERS = ['libvpx', 'libvpx-vp9'] as const;

/**
 * The encoder this installation's ffmpeg can write WebM with, or null (the caller keeps the takes).
 * @param caps - The installation's ffmpeg, for tests.
 * @param caps.available
 * @param caps.encoders
 */
export async function stitchEncoder(caps?: { available: boolean; encoders: Set<string> }): Promise<string | null> {
  const c = caps ?? await ffmpegCapabilities();
  if (!c.available) {
    return null;
  }
  return STITCH_ENCODERS.find(e => c.encoders.has(e)) ?? null;
}

/** How long before a tab's first line its take is shown: the move into the tab, the cursor, the page. */
export const STITCH_LEAD_MS = 1500;

/**
 * The order the story was told across takes, as cuts. Null when there is nothing to stitch:
 * fewer than two takes, or no line said in more than one of them.
 * @param takes - The tabs' recordings.
 * @param leadMs - How long before a tab's first line its take is shown.
 */
export function planStitch(takes: readonly Take[], leadMs: number = STITCH_LEAD_MS): StitchPlan | null {
  const starts = takes.map(t => Date.parse(t.startedAt));
  const ends = takes.map(t => Date.parse(t.endedAt));
  if (takes.length < 2 || starts.some(n => !Number.isFinite(n)) || ends.some(n => !Number.isFinite(n))) {
    return null;
  }
  const lines = takes
    .flatMap((t, take) => t.script.map(l => ({ take, abs: starts[take]! + l.atMs, text: l.text })))
    .sort((a, b) => a.abs - b.abs || a.take - b.take);
  const told = new Set(lines.map(l => l.take));
  if (told.size < 2) {
    return null;
  }
  // Runs: consecutive lines told in the same take.
  const runs: Array<{ take: number; firstAbs: number }> = [];
  for (const l of lines) {
    if (runs.length === 0 || runs.at(-1)!.take !== l.take) {
      runs.push({ take: l.take, firstAbs: l.abs });
    }
  }
  // Where each run's stretch starts on the real clock: a lead before its first line, never before
  // its take started nor before the previous stretch started.
  const switchAbs: number[] = [];
  for (const [k, r] of runs.entries()) {
    const earliest = Math.max(starts[r.take]!, k === 0 ? starts[r.take]! : switchAbs[k - 1]!);
    switchAbs.push(k === 0 ? starts[r.take]! : Math.max(earliest, r.firstAbs - leadMs));
  }
  const segments: Segment[] = [];
  const offsets: number[] = [];
  let clock = 0;
  for (const [k, r] of runs.entries()) {
    const fromAbs = switchAbs[k]!;
    const toAbs = Math.min(k + 1 < runs.length ? switchAbs[k + 1]! : ends[r.take]!, ends[r.take]!);
    const fromMs = Math.max(0, fromAbs - starts[r.take]!);
    const toMs = Math.max(fromMs, toAbs - starts[r.take]!);
    offsets.push(clock);
    segments.push({ take: r.take, fromMs, toMs });
    clock += toMs - fromMs;
  }
  const onClock = (take: number, absMs: number): number | null => {
    for (const [k, r] of runs.entries()) {
      if (r.take !== take) {
        continue;
      }
      const fromAbs = switchAbs[k]!;
      const toAbs = fromAbs + (segments[k]!.toMs - segments[k]!.fromMs);
      if (absMs >= fromAbs && absMs < toAbs) {
        return offsets[k]! + (absMs - fromAbs);
      }
    }
    return null;
  };
  const script = lines
    .map(l => ({ atMs: onClock(l.take, l.abs), text: l.text }))
    .filter((l): l is { atMs: number; text: string } => l.atMs !== null)
    .map(l => ({ atMs: Math.round(l.atMs), text: l.text }));
  const timeline = takes
    .flatMap((t, take) => (t.timeline ?? []).map(m => ({ m, at: onClock(take, starts[take]! + m.atMs) })))
    .filter((x): x is { m: { atMs: number } & Record<string, unknown>; at: number } => x.at !== null)
    .map(x => ({ ...x.m, atMs: Math.round(x.at) }))
    .sort((a, b) => a.atMs - b.atMs);
  return { segments, script, timeline, durationMs: Math.round(clock) };
}

/**
 * Cut the segments from their takes and join them into one video, in order. Never throws: a
 * failed cut comes back as its reason, and the caller files the takes as they were.
 * @param takes - The tabs' recordings.
 * @param plan - From {@link planStitch}.
 * @param out - Where to write the stitched video (`.webm`).
 * @param deps - Seams for tests.
 * @param deps.ffmpeg - The binary.
 * @param deps.run - How it is run.
 * @param deps.encoder
 */
export async function stitchTakes(takes: readonly Take[], plan: StitchPlan, out: string, deps: { ffmpeg?: string; run?: typeof run; encoder?: string | null } = {}): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  try {
    const encoder = deps.encoder === undefined ? await stitchEncoder() : deps.encoder;
    if (!encoder) {
      return { ok: false, reason: 'the takes could not be stitched (this installation\'s ffmpeg cannot write WebM: no libvpx encoder)' };
    }
    return await cut(takes, plan, out, { ...deps, encoder });
  } catch (e) {
    return { ok: false, reason: `the takes could not be stitched (${(e as Error).message.slice(0, 200)})` };
  }
}

async function cut(takes: readonly Take[], plan: StitchPlan, out: string, deps: { ffmpeg?: string; run?: typeof run; encoder: string }): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const bin = deps.ffmpeg ?? ffmpegBin();
  const exec = deps.run ?? run;
  const inputs = [...new Set(plan.segments.map(s => s.take))];
  if (inputs.some(i => !takes[i]?.path)) {
    throw new Error('a segment names a take that is not there');
  }
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const take of inputs) {
    args.push('-i', takes[take]!.path);
  }
  const parts = plan.segments.map((s, k) => `[${inputs.indexOf(s.take)}:v]trim=start=${(s.fromMs / 1000).toFixed(3)}:end=${(s.toMs / 1000).toFixed(3)},setpts=PTS-STARTPTS[v${k}]`);
  const filter = `${parts.join(';')};${plan.segments.map((_, k) => `[v${k}]`).join('')}concat=n=${plan.segments.length}:v=1:a=0[v]`;
  args.push('-filter_complex', filter, '-map', '[v]', '-c:v', deps.encoder, '-b:v', '2M', '-crf', '10', '-r', '25', '-an', out);
  const res = await exec(bin, args, Math.max(120_000, plan.durationMs * 4));
  if (res.code !== 0) {
    const tail = res.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300);
    return { ok: false, reason: `the takes could not be stitched (${res.error ?? tail ?? `exit ${res.code}`})` };
  }
  return { ok: true, path: out };
}
