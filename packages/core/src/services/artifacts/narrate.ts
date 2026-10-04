/**
 * NARRATE A RECORDING: the second pass over a kept recording (Chris,
 * 2026-10-03). Each line of a walkthrough script is spoken in the workspace's
 * voice (`services/voice/provider.ts`), the lines are placed at their moments
 * (`libs/media/narration.ts`), and one ffmpeg pass lays the agent's round
 * avatar bubble — pulsing while it speaks — and the voiceover over the
 * original video. The result is kept by the media store and filed beside the
 * source on every record the source is on, its role the source's with
 * `-narrated` (`qa-live-video-narrated`), its spec naming the source
 * (`narratedFrom`) and the script as spoken.
 *
 * Never throws. Every refusal is a sentence for a person: no ffmpeg on this
 * installation, no voice connected, a source that is not a kept recording, a
 * voice that refused a line, an encode that failed.
 */

import type { Buffer } from 'node:buffer';
import type { RecordingFiledPayload } from './recordings';
import type { ProbedVideo } from '@/libs/media/ffmpeg';
import type { PlacedLine, ScriptLine } from '@/libs/media/narration';
import type { MediaDeps } from '@/libs/tools/artifacts/media';
import type { VoiceProvider } from '@/libs/voice/provider';
import type { Author } from '@/services/ArtifactService';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffmpegBin, ffmpegCapabilities, probeAudioMs, probeVideo, run } from '@/libs/media/ffmpeg';
import { accentHex, addressBarSvg, addressSpans, bubbleGeometry, circleMaskSvg, demoCut, haloSvg, initialsBubbleSvg, narrationCommand, placeLines, rimSvg, URL_BAR } from '@/libs/media/narration';
import { MEDIA_ROUTE_BASE } from '@/libs/tools/artifacts/media';
import { fileRecording, NARRATED_SUFFIX, narratedRole } from './recordings';

/** The most lines one narration speaks. */
export const MAX_SCRIPT_LINES = 12;
/** The most characters one narration spends on the voice. */
export const MAX_SCRIPT_CHARS = 2_000;
/** The largest avatar image fetched. */
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

export type NarrationAvatar = {
  /** The agent's own image (https or data:), when it has one. */
  imageUrl?: string | null;
  /** Shown when there is no image, or it cannot be read. */
  initials: string;
  /** The bubble's color: an accent name or `#RRGGBB`. */
  color: string;
};

export type NarrateResult
  = | { ok: true; url: string; artifactIds: number[]; spoken: PlacedLine[]; dropped: number; characters: number }
    | { ok: false; reason: string };

/** The source recording, as narration reads it. */
type SourceRecording = { id: number; title: string; url: string; caption: string; contentType: string; filename: string; keptUnder: string; role: string; records: Array<{ id: number; role: string }>; /** The moments the recording logged (`spec.timeline`), source times. */ timeline: Array<{ atMs: number; what?: string; url?: string | null }> };

export type NarrateDeps = MediaDeps & {
  voice?: VoiceProvider | null;
  /** The source recording's row and its siblings (the same file filed on other records). */
  loadSource?: (orgId: string, artifactId: number) => Promise<SourceRecording | { error: string }>;
  /** The source's bytes, written to `dest`. */
  fetchSource?: (orgId: string, src: SourceRecording, dest: string) => Promise<string | null>;
  /** Fetch an avatar image. */
  fetchImage?: (url: string) => Promise<Buffer | null>;
  file?: typeof fileRecording;
  announce?: (orgId: string, payload: RecordingFiledPayload) => Promise<void>;
};

/**
 * The source recording and every record it is filed on. A source must be a
 * recording this installation keeps (its media route), not a link out.
 * @param orgId - The workspace.
 * @param artifactId - The source artifact.
 */
async function loadSourceFromDb(orgId: string, artifactId: number): Promise<SourceRecording | { error: string }> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { artifactSchema } = await import('@/models/Schema');
  const [row] = await db.select().from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, artifactId))).limit(1);
  if (!row) {
    return { error: `there is no recording #${artifactId} in this workspace.` };
  }
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const url = typeof spec.url === 'string' ? spec.url : row.url ?? '';
  const m = new RegExp(`^${MEDIA_ROUTE_BASE}/([\\w-]+)/([\\w-]+\\.(?:webm|mp4))$`).exec(url);
  if (!m) {
    return { error: `recording #${artifactId} is not one this installation keeps, so it cannot be narrated.` };
  }
  const siblings = await db
    .select({ recordType: artifactSchema.recordType, recordId: artifactSchema.recordId, recordRole: artifactSchema.recordRole })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.url, url)));
  const records = siblings
    .filter(s => s.recordType === 'object' && s.recordRole && !s.recordRole.endsWith(NARRATED_SUFFIX) && Number(s.recordId) > 0)
    .map(s => ({ id: Number(s.recordId), role: s.recordRole! }));
  return {
    id: row.id,
    title: row.title,
    url,
    caption: typeof spec.caption === 'string' ? spec.caption : row.title,
    contentType: typeof spec.contentType === 'string' ? spec.contentType : 'video/webm',
    filename: m[2]!,
    keptUnder: m[1]!,
    role: row.recordRole ?? 'recording',
    records,
    timeline: Array.isArray(spec.timeline) ? (spec.timeline as Array<{ atMs?: unknown; what?: unknown; url?: unknown }>).filter(m => Number.isFinite(Number(m.atMs))).map(m => ({ atMs: Number(m.atMs), ...(typeof m.what === 'string' ? { what: m.what } : {}), ...(typeof m.url === 'string' ? { url: m.url } : {}) })) : [],
  };
}

/**
 * Write the source's bytes to `dest`: copied from disk, or read from the
 * bucket. Null when it is in neither.
 * @param orgId - The workspace (the key's first segment).
 * @param src - The source.
 * @param dest - Where to write it.
 */
async function fetchSourceFromStore(orgId: string, src: SourceRecording, dest: string): Promise<string | null> {
  const { locateMedia } = await import('@/libs/tools/artifacts/media');
  const at = await locateMedia(orgId, src.keptUnder, src.filename);
  if (!at) {
    return null;
  }
  if (at.store === 'disk') {
    await writeFile(dest, await readFile(at.abs));
    return dest;
  }
  const { getObjectBytes } = await import('@/libs/aws/s3');
  const { bytes } = await getObjectBytes({ bucket: at.bucket, key: at.key, region: at.region });
  await writeFile(dest, bytes);
  return dest;
}

/**
 * An avatar image from an https or data: URL, capped. Null when it cannot be read.
 * @param url - The image's address.
 */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  const { Buffer } = await import('node:buffer');
  const data = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (data) {
    const bytes = Buffer.from(data[1]!, 'base64');
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_AVATAR_BYTES ? bytes : null;
  }
  if (!/^https:\/\//i.test(url)) {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) {
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_AVATAR_BYTES ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The bubble and ring PNGs: the avatar image cut round with a white rim, or
 * the initials on the accent color; the ring a soft disc in the accent color.
 * @param avatar - Who is speaking.
 * @param size - The bubble's diameter.
 * @param halo - The ring's diameter.
 * @param fetchImage - How an image is fetched.
 */
async function drawBubble(avatar: NarrationAvatar, size: number, halo: number, fetchImage: (url: string) => Promise<Buffer | null>): Promise<{ bubble: Buffer; halo: Buffer; usedImage: boolean }> {
  const { Buffer } = await import('node:buffer');
  const sharp = (await import('sharp')).default;
  const color = accentHex(avatar.color);
  let bubble: Buffer | null = null;
  if (avatar.imageUrl) {
    const image = await fetchImage(avatar.imageUrl).catch(() => null);
    if (image) {
      try {
        bubble = await sharp(image)
          .resize(size, size, { fit: 'cover' })
          .ensureAlpha()
          .composite([
            { input: Buffer.from(circleMaskSvg(size)), blend: 'dest-in' },
            { input: Buffer.from(rimSvg(size)), blend: 'over' },
          ])
          .png()
          .toBuffer();
      } catch {
        bubble = null;
      }
    }
  }
  const usedImage = bubble !== null;
  if (!bubble) {
    bubble = await sharp(Buffer.from(initialsBubbleSvg(size, (avatar.initials || '?').slice(0, 2), color))).png().toBuffer();
  }
  const ring = await sharp(Buffer.from(haloSvg(halo, color))).png().toBuffer();
  return { bubble, halo: ring, usedImage };
}

/**
 * Narrate a kept recording and file the narrated version beside it.
 * @param input - What to narrate, what to say, and who says it.
 * @param input.orgId - The workspace.
 * @param input.recordingArtifactId - The source recording's artifact (any one of its filings).
 * @param input.script - The walkthrough: when each line starts, what it says — or a writer
 *   given the recording's size and length, called once the file is read.
 * @param input.voiceId - The voice to speak in.
 * @param input.voiceSpeed - The speaking pace handed to the voice, 1 = its own.
 * @param input.demo - A demo: cut the idle stretches and draw the address bar.
 * @param input.avatar - The speaker's bubble.
 * @param input.speaker - Who speaks, for the spec and the caption (the agent's name and slug).
 * @param input.speaker.name - The agent's name.
 * @param input.speaker.slug - The agent's slug.
 * @param input.author - Who it is filed as.
 * @param deps - Seams for tests.
 */
export async function narrateRecording(input: {
  orgId: string;
  recordingArtifactId: number;
  script: ScriptLine[] | ((recording: ProbedVideo) => Promise<ScriptLine[] | { error: string }>);
  voiceId: string;
  /** The speaking pace handed to the voice, 1 = its own (Chris, 2026-10-04: "pace of the demo could be a touch faster"). */
  voiceSpeed?: number;
  /**
   * A demo's cut and chrome (Chris, 2026-10-04): the idle stretches between steps are shortened
   * (`demoCut`) and an address bar is drawn above the picture from the moments the recording logged.
   */
  demo?: boolean;
  avatar: NarrationAvatar;
  speaker?: { name: string; slug?: string };
  author?: Author;
}, deps: NarrateDeps = {}): Promise<NarrateResult> {
  const caps = await ffmpegCapabilities();
  if (!caps.available) {
    return { ok: false, reason: `${caps.reason}, so a recording cannot be narrated here.` };
  }
  const voice = deps.voice !== undefined ? deps.voice : await (await import('@/services/voice/provider')).voiceProvider(input.orgId);
  if (!voice) {
    return { ok: false, reason: 'no voice is connected to this workspace (Connections), so the recording was not narrated.' };
  }
  const src = await (deps.loadSource ?? loadSourceFromDb)(input.orgId, input.recordingArtifactId);
  if ('error' in src) {
    return { ok: false, reason: src.error };
  }
  if (src.role.endsWith(NARRATED_SUFFIX)) {
    return { ok: false, reason: `recording #${src.id} is already a narration.` };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'vocion-narrate-'));
  try {
    const ext = src.filename.split('.').pop() ?? 'webm';
    const video = await (deps.fetchSource ?? fetchSourceFromStore)(input.orgId, src, path.join(dir, `source.${ext}`)).catch(() => null);
    if (!video) {
      return { ok: false, reason: `the file behind recording #${src.id} could not be found in the media store.` };
    }
    const probed = await probeVideo(video);
    if ('error' in probed) {
      return { ok: false, reason: probed.error };
    }
    // A script written for this recording is written now, knowing its length.
    const written = typeof input.script === 'function' ? await input.script(probed) : input.script;
    if (!Array.isArray(written)) {
      return { ok: false, reason: written.error };
    }
    const script = written
      .map(l => ({ atMs: Math.max(0, Math.round(Number(l.atMs) || 0)), text: String(l.text ?? '').replace(/\s+/g, ' ').trim() }))
      .filter(l => l.text !== '')
      .slice(0, MAX_SCRIPT_LINES);
    if (script.length === 0) {
      return { ok: false, reason: 'the walkthrough has no lines to speak.' };
    }
    const characters = script.reduce((n, l) => n + l.text.length, 0);
    if (characters > MAX_SCRIPT_CHARS) {
      return { ok: false, reason: `the walkthrough is ${characters} characters, over the ${MAX_SCRIPT_CHARS} one narration may spend.` };
    }

    // Each line spoken, in order; the first refusal stops the narration with its reason.
    const spokenFiles: Array<ScriptLine & { file: string; durationMs: number }> = [];
    for (const [i, line] of script.entries()) {
      const said = await voice.speak({ voiceId: input.voiceId, text: line.text, ...(input.voiceSpeed ? { speed: input.voiceSpeed } : {}) });
      if (!said.ok) {
        return { ok: false, reason: `${voice.label} did not speak line ${i + 1}: ${said.reason}` };
      }
      const file = path.join(dir, `line-${i}.mp3`);
      await writeFile(file, said.audio);
      const durationMs = said.durationMs ?? await probeAudioMs(file);
      if (!durationMs) {
        return { ok: false, reason: `line ${i + 1} came back from ${voice.label} as audio that could not be read.` };
      }
      spokenFiles.push({ ...line, file, durationMs });
    }
    const { placed: placedOnSource, dropped } = placeLines(spokenFiles, probed.durationMs);
    if (placedOnSource.length === 0) {
      return { ok: false, reason: `the recording is ${(probed.durationMs / 1000).toFixed(1)}s long, too short for any line of the walkthrough.` };
    }
    // THE DEMO CUT: the idle stretches go, and every time from here on is the cut video's.
    const cut = input.demo ? demoCut(src.timeline, placedOnSource, probed.durationMs) : null;
    const remap = cut ? cut.remap : (ms: number) => ms;
    const placed: PlacedLine[] = cut
      ? placedOnSource.map(l => ({ ...l, startMs: remap(l.startMs), endMs: remap(l.startMs) + l.durationMs }))
      : placedOnSource;
    const durationMs = cut ? Math.max(cut.durationMs, placed.at(-1)?.endMs ?? 0) : probed.durationMs;
    // THE ADDRESS BAR above the picture, one strip per stretch at one address.
    const spans = input.demo ? addressSpans(src.timeline, remap, durationMs).slice(0, 12) : [];
    const barFiles = new Map<string, string>();
    const bars: Array<{ file: string; fromMs: number; toMs: number }> = [];
    if (spans.length > 0) {
      const sharp = (await import('sharp')).default;
      const { Buffer: Bytes } = await import('node:buffer');
      for (const span of spans) {
        let file = barFiles.get(span.address);
        if (!file) {
          file = path.join(dir, `bar-${barFiles.size}.png`);
          await writeFile(file, await sharp(Bytes.from(addressBarSvg(probed.width, span.address))).png().toBuffer());
          barFiles.set(span.address, file);
        }
        bars.push({ file, fromMs: span.fromMs, toMs: span.toMs });
      }
    }
    const barHeight = bars.length > 0 ? URL_BAR.height : 0;

    const geometry = bubbleGeometry(probed.width, probed.height + barHeight);
    const art = await drawBubble(input.avatar, geometry.size, geometry.halo, deps.fetchImage ?? fetchImageBytes);
    const bubbleFile = path.join(dir, 'bubble.png');
    const haloFile = path.join(dir, 'halo.png');
    await writeFile(bubbleFile, art.bubble);
    await writeFile(haloFile, art.halo);

    const mp4 = caps.encoders.has('libx264') && caps.encoders.has('aac');
    if (!mp4 && !(caps.encoders.has('libvpx') && caps.encoders.has('libopus'))) {
      return { ok: false, reason: 'ffmpeg on this installation has neither H.264/AAC nor VP8/Opus encoders, so the narrated video could not be written.' };
    }
    const out = path.join(dir, mp4 ? 'narrated.mp4' : 'narrated.webm');
    const cmd = narrationCommand({
      video,
      bubble: bubbleFile,
      halo: haloFile,
      clips: placed.map(p => spokenFiles[p.index]!.file),
      placed,
      geometry,
      durationMs,
      out,
      mp4,
      pulse: caps.filters.has('geq'),
      cut: cut?.selectExpr ?? null,
      bars,
      barHeight,
    });
    const encoded = await run(ffmpegBin(), cmd.args, Math.max(180_000, probed.durationMs * 6));
    if (encoded.code !== 0) {
      const tail = encoded.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300);
      return { ok: false, reason: `the narrated video could not be encoded (${encoded.error ?? tail ?? `exit ${encoded.code}`}).` };
    }
    const data = await readFile(out);
    const speakerName = input.speaker?.name?.trim() || 'the agent';
    const caption = `${src.caption} · narrated by ${speakerName}`.slice(0, 300);
    const records = src.records.length > 0 ? src.records : [];
    if (records.length === 0) {
      return { ok: false, reason: `recording #${src.id} is filed on no record, so its narration has nowhere to go.` };
    }
    const filed = await (deps.file ?? fileRecording)({
      orgId: input.orgId,
      keptUnder: Number(src.keptUnder) || records[0]!.id,
      name: `${src.filename.replace(/-[0-9a-f]{16}\.\w+$/, '').replace(/\.\w+$/, '')}-narrated`,
      data,
      contentType: mp4 ? 'video/mp4' : 'video/webm',
      records: records.map(r => ({ id: r.id, role: narratedRole(r.role) })),
      title: `Narrated: ${src.title}`.slice(0, 120),
      caption,
      author: input.author ?? { kind: 'system', id: 'narration' },
      extraSpec: {
        narratedFrom: src.id,
        narratedFromUrl: src.url,
        script: placed.map(p => ({ atMs: p.startMs, endMs: p.endMs, text: p.text })),
        speaker: { name: speakerName, ...(input.speaker?.slug ? { slug: input.speaker.slug } : {}) },
      },
      provenance: {
        narration: true,
        narratedFrom: src.id,
        voice: { connector: voice.connector, voiceId: input.voiceId },
        avatar: art.usedImage ? 'image' : 'initials',
        characters,
        dropped,
      },
    }, deps);
    if (!filed.ok) {
      return { ok: false, reason: `the narrated video was made but not kept: ${filed.reason}` };
    }
    return { ok: true, url: filed.url, artifactIds: filed.artifactIds, spoken: placed, dropped, characters };
  } catch (err) {
    return { ok: false, reason: `the recording could not be narrated (${(err as Error)?.message?.slice(0, 200) ?? 'unknown error'}).` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
