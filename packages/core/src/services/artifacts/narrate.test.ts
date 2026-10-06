import type { VoiceProvider } from '@/libs/voice/provider';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ffmpegCapabilities, probeVideo } from '@/libs/media/ffmpeg';
import { bubbleGeometry, CAPTION_BAND } from '@/libs/media/narration';
import { narrateRecording } from './narrate';

/**
 * The narration mechanism: refusals in words, and — where this machine has
 * ffmpeg — a real encode of a generated recording with a stand-in voice, read
 * back to prove the bubble pass and the soundtrack landed.
 */

const HAS_FFMPEG = spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0 && spawnSync('ffprobe', ['-hide_banner', '-version']).status === 0;

const source = { id: 41, title: 'Live check of REL-9, 2026-09-20', url: '/api/media/77/live-check-desktop-1-0123456789abcdef.webm', caption: 'Live check of REL-9, 2026-09-20', contentType: 'video/webm', filename: 'live-check-desktop-1-0123456789abcdef.webm', keptUnder: '77', role: 'qa-live-video', records: [{ id: 12, role: 'qa-live-video' }, { id: 77, role: 'qa-live-video' }], timeline: [] };

let dir = '';
let video = '';
let tone = Buffer.alloc(0);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'narrate-test-'));
  if (!HAS_FFMPEG) {
    return;
  }
  video = path.join(dir, 'src.webm');
  // A 6-second 640x400 VP8 recording, like a browser's: a moving test pattern, no sound.
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x400:rate=25:duration=6', '-c:v', 'libvpx', '-b:v', '500k', video]);
  const mp3 = path.join(dir, 'tone.mp3');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
  tone = await readFile(mp3);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function voice(over: Partial<VoiceProvider> = {}): VoiceProvider {
  return {
    connector: 'voice-fixture',
    label: 'Fixture Voice',
    listVoices: async () => ({ ok: true, voices: [{ id: 'v1', name: 'Northwind' }] }),
    speak: vi.fn(async () => ({ ok: true as const, audio: tone, contentType: 'audio/mpeg' as const })),
    ...over,
  };
}

const script = [
  { atMs: 500, text: 'I open the room as the QA account.' },
  { atMs: 2_500, text: 'Export offers a PDF, and it downloads.' },
];

describe('narrateRecording refuses in words, never throws', () => {
  it('says when no voice is connected', async () => {
    const caps = await ffmpegCapabilities();
    const res = await narrateRecording({ orgId: 'org_n', recordingArtifactId: 41, script, voiceId: 'v1', avatar: { initials: 'QA', color: 'emerald' } }, { voice: null });

    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.reason).toMatch(caps.available ? /no voice is connected/ : /not installed/);
  });

  it('says when ffmpeg is not installed', async () => {
    const before = process.env.VOCION_FFMPEG;
    process.env.VOCION_FFMPEG = '/nonexistent/ffmpeg';
    try {
      await ffmpegCapabilities(true);
      const res = await narrateRecording({ orgId: 'org_n', recordingArtifactId: 41, script, voiceId: 'v1', avatar: { initials: 'QA', color: 'emerald' } }, { voice: voice() });

      expect(res).toEqual({ ok: false, reason: expect.stringMatching(/ffmpeg is not installed on this installation.*cannot be narrated/) });
    } finally {
      if (before === undefined) {
        delete process.env.VOCION_FFMPEG;
      } else {
        process.env.VOCION_FFMPEG = before;
      }
      await ffmpegCapabilities(true);
    }
  });

  it.runIf(HAS_FFMPEG)('says which line the voice refused, and files nothing', async () => {
    const file = vi.fn();
    const res = await narrateRecording({ orgId: 'org_n', recordingArtifactId: 41, script, voiceId: 'v1', avatar: { initials: 'QA', color: 'emerald' } }, {
      voice: voice({ speak: async () => ({ ok: false, reason: 'The account has no characters left this period.' }) }),
      loadSource: async () => source,
      fetchSource: async (_o, _s, dest) => {
        await copyFile(video, dest);
        return dest;
      },
      file,
    });

    expect(res).toEqual({ ok: false, reason: 'Fixture Voice did not speak line 1: The account has no characters left this period.' });
    expect(file).not.toHaveBeenCalled();
  });

  it('refuses to narrate a narration', async () => {
    const caps = await ffmpegCapabilities();
    const res = await narrateRecording({ orgId: 'org_n', recordingArtifactId: 41, script, voiceId: 'v1', avatar: { initials: 'QA', color: 'emerald' } }, { voice: voice(), loadSource: async () => ({ ...source, role: 'qa-live-video-narrated' }) });

    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.reason).toMatch(caps.available ? /already a narration/ : /not installed/);
  });
});

describe.runIf(HAS_FFMPEG)('narrateRecording with ffmpeg', () => {
  it('lays the bubble and the voiceover over the recording and files it beside the source', async () => {
    const speak = vi.fn(async () => ({ ok: true as const, audio: tone, contentType: 'audio/mpeg' as const }));
    let kept: { data: Buffer; contentType: string; records: Array<{ id: number; role: string }>; extraSpec?: Record<string, unknown>; keptUnder: number } | null = null;
    const res = await narrateRecording({
      orgId: 'org_n',
      recordingArtifactId: 41,
      script,
      voiceId: 'v1',
      avatar: { initials: 'QA', color: 'emerald' },
      speaker: { name: 'QA', slug: 'change-reviewer' },
    }, {
      voice: voice({ speak }),
      loadSource: async () => source,
      fetchSource: async (_o, _s, dest) => {
        await copyFile(video, dest);
        return dest;
      },
      file: (async (input: NonNullable<typeof kept>) => {
        kept = input;
        return { ok: true, url: '/api/media/77/live-check-desktop-1-narrated-feedfacefeedface.mp4', filename: 'x.mp4', bytes: input.data.byteLength, store: 'disk', artifactIds: [501, 502] };
      }) as never,
    });

    expect(res).toMatchObject({ ok: true, artifactIds: [501, 502], dropped: 0 });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenCalledWith({ voiceId: 'v1', text: 'I open the room as the QA account.' });
    expect(kept!.records).toEqual([{ id: 12, role: 'qa-live-video-narrated' }, { id: 77, role: 'qa-live-video-narrated' }]);
    expect(kept!.keptUnder).toBe(77);
    expect(kept!.extraSpec).toMatchObject({ narratedFrom: 41, script: [{ atMs: 500, text: 'I open the room as the QA account.' }, { atMs: 2_500 }] });

    // Read the encode back: same size, the source's length, and a soundtrack.
    const out = path.join(dir, `narrated.${kept!.contentType === 'video/mp4' ? 'mp4' : 'webm'}`);
    await writeFile(out, kept!.data);
    const probed = await probeVideo(out);

    expect(probed).toMatchObject({ width: 640, height: 400 + CAPTION_BAND.height });
    expect('durationMs' in probed ? Math.abs(probed.durationMs - 6_000) : Infinity).toBeLessThan(300);

    const streams = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).stdout.toString().trim().split('\n');

    expect(streams).toEqual(expect.arrayContaining(['video', 'audio']));

    // The bubble is drawn in the band below the picture (Chris, 2026-10-04: it covered a row
    // title): its centre differs from the band's plain ground, and the picture's old bottom-left
    // spot now matches the source, because nothing is drawn over the page any more.
    const frame = (file: string, x: number, y: number) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '3', '-i', file, '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
    const diff = (a: Buffer, b: Buffer) => [0, 1, 2].reduce((n, i) => n + Math.abs((a[i] ?? 0) - (b[i] ?? 0)), 0);
    const g = bubbleGeometry(640, 400, CAPTION_BAND.height);
    const bubbleCentre = { x: g.x + g.size / 2 - 4, y: g.y + g.size / 2 - 4 };

    expect(diff(frame(out, bubbleCentre.x, bubbleCentre.y), frame(out, 620, bubbleCentre.y))).toBeGreaterThan(40);

    const oldSpot = { x: 22 + 36 - 4, y: 400 - 72 - 22 + 36 - 4 };

    expect(diff(frame(video, oldSpot.x, oldSpot.y), frame(out, oldSpot.x, oldSpot.y))).toBeLessThan(40);
    expect(diff(frame(video, 600, 20), frame(out, 600, 20))).toBeLessThan(40);
  }, 60_000);
});
