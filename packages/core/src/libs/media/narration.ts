/**
 * A NARRATED RECORDING, PLANNED: the pure half of `services/artifacts/narrate.ts`.
 * Where each spoken line falls on the video, how big the avatar bubble is and
 * where it sits, how it is drawn, and the ffmpeg command that puts the three
 * together. No I/O here, so every number is testable without ffmpeg.
 *
 * The picture (Chris, 2026-10-03: "a second pass with an avatar bubble and
 * voiceover from the SF instance agent avatar"): the original recording,
 * untouched, with a round bubble in the bottom-left corner — the agent's own
 * image when it has one, else its initials on its accent color — about 18% of
 * the video's shorter side. A ring around the bubble pulses while a line is
 * being spoken and is gone between lines, so a viewer sees who is talking and
 * when. The lines are placed at the moments they describe and never overlap;
 * the soundtrack is padded or cut to the video's length.
 */

/** One line of the walkthrough as written: when it should start, what is said. */
export type ScriptLine = { atMs: number; text: string };

/** A spoken line, placed on the video. */
export type PlacedLine = { index: number; text: string; startMs: number; endMs: number; durationMs: number };

/** The bubble's share of the video's shorter side. */
export const BUBBLE_SHARE = 0.18;
/** The ring's diameter against the bubble's. */
export const HALO_SCALE = 1.36;
/** Silence kept between two lines. */
export const LINE_GAP_MS = 250;
/** A line that would start this close to the end is not spoken at all. */
export const MIN_TAIL_MS = 600;
/** How fast the ring pulses while a line is spoken. */
export const PULSE_HZ = 2.2;

/**
 * Where each line is spoken. In the order written (by `atMs`), each starts at
 * its moment or, when the line before is still speaking, just after it. A line
 * that cannot start before the last {@link MIN_TAIL_MS} of the video is
 * dropped and counted; the last line spoken is cut at the video's end.
 * @param lines - The script with each clip's measured length.
 * @param videoMs - The video's length.
 * @param gapMs - Silence between lines.
 */
export function placeLines(lines: ReadonlyArray<ScriptLine & { durationMs: number }>, videoMs: number, gapMs = LINE_GAP_MS): { placed: PlacedLine[]; dropped: number } {
  const order = lines
    .map((l, index) => ({ ...l, index }))
    .filter(l => l.text.trim() !== '' && l.durationMs > 0)
    .sort((a, b) => a.atMs - b.atMs || a.index - b.index);
  const placed: PlacedLine[] = [];
  let cursor = 0;
  let dropped = lines.length - order.length;
  for (const l of order) {
    const startMs = Math.max(0, Math.round(l.atMs), cursor);
    if (startMs > videoMs - MIN_TAIL_MS) {
      dropped += 1;
      continue;
    }
    const endMs = Math.min(videoMs, startMs + Math.round(l.durationMs));
    placed.push({ index: l.index, text: l.text, startMs, endMs, durationMs: endMs - startMs });
    cursor = endMs + gapMs;
  }
  return { placed, dropped };
}

export type BubbleGeometry = {
  /** The bubble's diameter, even. */
  size: number;
  /** The ring's diameter, even. */
  halo: number;
  /** The bubble's top-left corner on the video. */
  x: number;
  y: number;
  /** The ring's top-left corner (centred on the bubble). */
  haloX: number;
  haloY: number;
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The bubble's size and place on a `width`×`height` video: {@link BUBBLE_SHARE}
 * of the shorter side, bottom-left, its margin wide enough for the ring.
 * @param width - Video width.
 * @param height - Video height.
 */
export function bubbleGeometry(width: number, height: number): BubbleGeometry {
  const size = even(Math.min(width, height) * BUBBLE_SHARE);
  const halo = even(size * HALO_SCALE);
  const margin = Math.round(size * 0.3);
  const x = margin;
  const y = Math.max(0, height - size - margin);
  const inset = (halo - size) / 2;
  return { size, halo, x, y, haloX: Math.round(x - inset), haloY: Math.round(y - inset) };
}

/**
 * Up to two initials from a name: "Quality Assurance" → "QA", "QA" → "QA",
 * "change-reviewer" → "CR". Letters and digits only; "?" when there are none.
 * @param name - The agent's name.
 */
export function initialsOf(name: string): string {
  const cleaned = name.trim();
  if (/^[A-Z0-9]{2,3}$/.test(cleaned)) {
    return cleaned.slice(0, 2);
  }
  const words = cleaned.split(/[\s\-_.]+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const letters = words.length === 1 ? [...words[0]!].slice(0, 2) : [words[0]![0]!, words[words.length - 1]![0]!];
  return letters.join('').toUpperCase();
}

/** Accent names (workspace YAML `accent:`) as the solid color the bubble is drawn in. */
const ACCENT_HEX: Record<string, string> = {
  amber: '#F18700',
  teal: '#0F8A7E',
  violet: '#7C5CFC',
  indigo: '#5B6EF5',
  rose: '#F0567A',
  emerald: '#059669',
  sky: '#0284C7',
  blue: '#2563EB',
  slate: '#475569',
  orange: '#EA580C',
  red: '#DC2626',
  green: '#16A34A',
  purple: '#9333EA',
  pink: '#DB2777',
};

/**
 * An agent's accent as `#RRGGBB`: a named accent, or a hex color as written;
 * amber, the brand color, otherwise.
 * @param accent - The agent's `accent`.
 */
export function accentHex(accent: string | null | undefined): string {
  const a = (accent ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(a)) {
    return a.toUpperCase();
  }
  if (/^#[0-9a-f]{3}$/.test(a)) {
    return `#${[...a.slice(1)].map(c => c + c).join('')}`.toUpperCase();
  }
  return ACCENT_HEX[a] ?? ACCENT_HEX.amber!;
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The bubble with initials, as SVG (rasterised by the caller): a filled
 * circle in the accent color, the initials in white, a white rim.
 * @param size - Diameter in pixels.
 * @param initials - One or two characters.
 * @param color - `#RRGGBB`.
 */
export function initialsBubbleSvg(size: number, initials: string, color: string): string {
  const r = size / 2;
  const rim = Math.max(2, Math.round(size * 0.035));
  const fontSize = Math.round(size * (initials.length > 1 ? 0.38 : 0.46));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<circle cx="${r}" cy="${r}" r="${r - rim / 2}" fill="${xmlEscape(color)}"/>`
    + `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#FFFFFF">${xmlEscape(initials)}</text>`
    + `<circle cx="${r}" cy="${r}" r="${r - rim / 2}" fill="none" stroke="#FFFFFF" stroke-width="${rim}"/>`
    + `</svg>`;
}

/**
 * A circle mask (white disc on transparent), to cut an avatar image round.
 * @param size - Diameter in pixels.
 */
export function circleMaskSvg(size: number): string {
  const r = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#FFFFFF"/></svg>`;
}

/**
 * The white rim drawn over a round avatar image.
 * @param size - Diameter in pixels.
 */
export function rimSvg(size: number): string {
  const r = size / 2;
  const rim = Math.max(2, Math.round(size * 0.035));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r - rim / 2}" fill="none" stroke="#FFFFFF" stroke-width="${rim}"/></svg>`;
}

/**
 * The ring behind the bubble, as SVG: a soft disc in the accent color, opaque
 * at the bubble's edge and fading outward. Its opacity pulses over time in
 * the ffmpeg pass.
 * @param size - The ring's diameter.
 * @param color - `#RRGGBB`.
 */
export function haloSvg(size: number, color: string): string {
  const r = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<defs><radialGradient id="g"><stop offset="55%" stop-color="${xmlEscape(color)}" stop-opacity="0.95"/><stop offset="100%" stop-color="${xmlEscape(color)}" stop-opacity="0"/></radialGradient></defs>`
    + `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/></svg>`;
}

/**
 * Seconds, as ffmpeg reads them in an expression: three decimals.
 * @param ms - Milliseconds.
 */
const sec = (ms: number) => (ms / 1000).toFixed(3);

/**
 * ffmpeg's `enable` expression for "while any line is speaking".
 * @param placed - The placed lines.
 */
export function speakingExpr(placed: readonly PlacedLine[]): string {
  return placed.length === 0 ? '0' : placed.map(l => `between(t,${sec(l.startMs)},${sec(l.endMs)})`).join('+');
}

export type NarrationCommand = {
  /** The full argument list for ffmpeg (no shell). */
  args: string[];
  /** The filter graph, for a test or a log to read. */
  filter: string;
};

/**
 * The one ffmpeg pass: inputs 0 the recording, 1 the bubble PNG, 2 the ring
 * PNG, then one MP3 per placed line. The ring is shown only while a line is
 * spoken and its opacity pulses at {@link PULSE_HZ} (when the build has the
 * `geq` filter; a plain on/off ring otherwise). Each line is delayed to its
 * start and mixed without normalising (lines never overlap); the soundtrack is
 * padded with silence and cut at the video's length. Output: H.264/AAC MP4
 * when the build has libx264, VP8/Opus WebM otherwise.
 * @param input - Files and plan.
 * @param input.video - The recording.
 * @param input.bubble - The bubble PNG.
 * @param input.halo - The ring PNG.
 * @param input.clips - One MP3 per placed line, in `placed` order.
 * @param input.placed - Where each line is spoken.
 * @param input.geometry - Where the bubble sits.
 * @param input.durationMs - The video's length.
 * @param input.out - The output file.
 * @param input.mp4 - Encode H.264/AAC MP4 (else VP8/Opus WebM).
 * @param input.pulse - The build has `geq`, so the ring can pulse.
 */
export function narrationCommand(input: {
  video: string;
  bubble: string;
  halo: string;
  clips: readonly string[];
  placed: readonly PlacedLine[];
  geometry: BubbleGeometry;
  durationMs: number;
  out: string;
  mp4: boolean;
  pulse: boolean;
}): NarrationCommand {
  const g = input.geometry;
  const dur = sec(input.durationMs);
  const halo = input.pulse
    ? `[2:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(0.55+0.45*sin(2*PI*${PULSE_HZ}*T))'[halo]`
    : `[2:v]format=rgba[halo]`;
  const parts: string[] = [
    `[1:v]format=rgba[bub]`,
    halo,
    `[0:v][halo]overlay=x=${g.haloX}:y=${g.haloY}:enable='${speakingExpr(input.placed)}':shortest=1[v1]`,
    `[v1][bub]overlay=x=${g.x}:y=${g.y}:shortest=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]`,
  ];
  const n = input.clips.length;
  if (n === 0) {
    parts.push(`anullsrc=r=44100:cl=stereo,atrim=end=${dur}[aout]`);
  } else {
    input.placed.forEach((l, i) => {
      parts.push(`[${i + 3}:a]aresample=44100,adelay=delays=${l.startMs}:all=1[a${i}]`);
    });
    const labels = input.placed.map((_, i) => `[a${i}]`).join('');
    parts.push(n === 1
      ? `${labels}apad,atrim=end=${dur}[aout]`
      : `${labels}amix=inputs=${n}:normalize=0:duration=longest,apad,atrim=end=${dur}[aout]`);
  }
  const filter = parts.join(';');
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input.video,
    '-loop',
    '1',
    '-i',
    input.bubble,
    '-loop',
    '1',
    '-i',
    input.halo,
    ...input.clips.flatMap(c => ['-i', c]),
    '-filter_complex',
    filter,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    dur,
    ...(input.mp4
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']
      : ['-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '96k']),
    input.out,
  ];
  return { args, filter };
}
