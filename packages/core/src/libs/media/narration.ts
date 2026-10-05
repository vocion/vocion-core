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

/**
 * Milliseconds as ffmpeg's seconds.
 * @param ms - The time.
 */
const sec = (ms: number) => (ms / 1000).toFixed(3);

/** How fast a line is spoken (characters per second): the budget a writer is given, and how long a demo holds the screen for a line. */
export const SPOKEN_CHARS_PER_SECOND = 14;

/** The least a demo holds the screen for one spoken line, and the most, whatever its length. */
export const DWELL_MS = { min: 1_400, max: 12_000, lead: 400 } as const;
export const URL_BAR = { height: 40, maxChars: 96 } as const;

/** When a recording's script carries no end for its first line, the frame is taken this long after it starts. */
export const POSTER_SETTLE_MS = 1_500;

/**
 * The second the preview frame of a recording is taken at: the END of the
 * first spoken line, when the state it describes has settled (walk 23,
 * 2026-10-04: the frame at the line's start showed a page still loading), or
 * null when the recording carries no script.
 * @param spec - The recording's spec (`script` as the narration placed it).
 */
export function posterSecond(spec: Record<string, unknown> | null | undefined): number | null {
  const script = Array.isArray(spec?.script) ? spec.script as Array<{ atMs?: unknown; endMs?: unknown }> : [];
  const first = script
    .map(l => ({ at: Number(l.atMs), end: Number(l.endMs) }))
    .filter(l => Number.isFinite(l.at) && l.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!first) {
    return null;
  }
  const at = Number.isFinite(first.end) && first.end > first.at ? first.end : first.at + POSTER_SETTLE_MS;
  return Math.round(at) / 1000;
}
/**
 * The band below the picture that carries the speaker's bubble and the spoken
 * line as a subtitle (Chris, 2026-10-04, via the peer's frame-by-frame read of
 * FE-449: the bubble sat over a row title). Nothing is drawn over the picture.
 */
export const CAPTION_BAND = { height: 104, fontSize: 22, maxChars: 150 } as const;

/**
 * How long a line takes to say, with a short lead so the viewer sees the state before the voice
 * starts — the time a demo recording holds the screen on the state the line describes
 * (Chris, 2026-10-03: "1.5 seconds of page loading; that I have to guess is a vanity url").
 * @param text - The line.
 */
export function spokenMs(text: string): number {
  const chars = text.trim().length;
  return Math.min(DWELL_MS.max, Math.max(DWELL_MS.min, DWELL_MS.lead + Math.round((chars / SPOKEN_CHARS_PER_SECOND) * 1000)));
}

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
 * @param band
 */
export function bubbleGeometry(width: number, height: number, band = 0): BubbleGeometry {
  if (band > 0) {
    // In the band below the picture: as tall as the band allows, at the left.
    const size = even(Math.min(band * 0.72, Math.min(width, height) * BUBBLE_SHARE));
    const halo = even(Math.min(band - 2, size * HALO_SCALE));
    const x = Math.round(band * 0.14) + Math.round((halo - size) / 2);
    const y = height + Math.round((band - size) / 2);
    const inset = (halo - size) / 2;
    return { size, halo, x, y, haloX: Math.round(x - inset), haloY: Math.round(y - inset) };
  }
  const size = even(Math.min(width, height) * BUBBLE_SHARE);
  const halo = even(size * HALO_SCALE);
  const margin = Math.round(size * 0.3);
  const x = margin;
  const y = Math.max(0, height - size - margin);
  const inset = (halo - size) / 2;
  return { size, halo, x, y, haloX: Math.round(x - inset), haloY: Math.round(y - inset) };
}

/**
 * Where the subtitle starts in the band: right of the bubble and its ring.
 * @param g - The bubble's geometry in the band.
 */
export function captionLeft(g: BubbleGeometry): number {
  return g.haloX + g.halo + Math.round(CAPTION_BAND.height * 0.2);
}

/**
 * One spoken line as the band's subtitle, wrapped to two lines at most.
 * @param width - The video's width.
 * @param text - The line.
 * @param left - Where the text starts (right of the bubble).
 */
export function captionSvg(width: number, text: string, left: number): string {
  const h = CAPTION_BAND.height;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const room = Math.max(10, Math.floor((width - left - 24) / (CAPTION_BAND.fontSize * 0.52)));
  const words = text.trim().slice(0, CAPTION_BAND.maxChars).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (`${cur} ${w}`).length > room) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
    if (lines.length === 2) {
      break;
    }
  }
  if (lines.length < 2 && cur) {
    lines.push(cur);
  }
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) {
    lines[1] = `${lines[1]!.replace(/\s+\S*$/, '')}…`;
  }
  const lh = CAPTION_BAND.fontSize * 1.3;
  const top = h / 2 - ((lines.length - 1) * lh) / 2 + CAPTION_BAND.fontSize * 0.35;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
  <rect width="${width}" height="${h}" fill="#1b1b1f"/>
  ${lines.map((l, i) => `<text x="${left}" y="${(top + i * lh).toFixed(1)}" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="${CAPTION_BAND.fontSize}" fill="#f2f2f5">${esc(l)}</text>`).join('\n  ')}
</svg>`;
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
/**
 * THE ONE ACCENT every demo overlay shares (Chris, 2026-10-04: "the focus area or
 * overlay should use the same color as our avatar overlay. Be subtle."): the
 * mark's own blue. The ring round the bubble, the ripple on a click and the
 * outline on the area being spoken about are all drawn in it.
 */
export const DEMO_ACCENT = '#4D63FF';

/**
 * The accent as `rgba(r,g,b,a)`, for CSS that needs an alpha.
 * @param alpha
 * @param hex
 */
export function accentRgba(alpha: number, hex: string = DEMO_ACCENT): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The speaker's bubble: the Vocion mark on Vocion Ink, as the app's own icon
 * draws it (`app/apple-icon.tsx`), with a white rim (Chris, 2026-10-04: "Use
 * the Vocion avatar not 'QA' in the avatar. Use Vocion colors").
 * @param size - The bubble's diameter.
 */
export function vocionMarkBubbleSvg(size: number): string {
  const r = size / 2;
  // The mark's own box is 180 by 130; it sits in the disc at 58% of the width.
  const w = size * 0.58;
  const k = w / 180;
  const x = (size - w) / 2;
  const y = (size - 130 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="l" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#7C3CFF"/><stop offset="52%" stop-color="#4D63FF"/><stop offset="100%" stop-color="#168BFF"/></linearGradient>
    <linearGradient id="r" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#168BFF"/><stop offset="58%" stop-color="#16D6D2"/><stop offset="100%" stop-color="#55F58A"/></linearGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r}" fill="#0B1020"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 22 L74 106 L136 16" stroke="url(#l)" stroke-width="17"/>
    <path d="M56 24 L77 60 L98 30" stroke="url(#r)" stroke-width="17"/>
  </g>
  <circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="none" stroke="#FFFFFF" stroke-width="3"/>
</svg>`;
}

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
 * @param input.cut - The `select` expression keeping the demo's moments, or nothing to keep the whole video.
 * @param input.bars - The address-bar strips and the stretch of the (cut) video each one covers.
 * @param input.barHeight - The strip's height, added above the picture.
 * @param input.captions
 * @param input.bandHeight
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
  /** The demo cut's `select` expression (`demoCut`), or none to keep the whole video. `placed` and `durationMs` are then in the cut's clock. */
  cut?: string | null;
  /** Address bars to show above the picture, each for a stretch of the (cut) video; `barHeight` pads the frame for them. */
  bars?: ReadonlyArray<{ file: string; fromMs: number; toMs: number }>;
  barHeight?: number;
  /** Subtitles in the band below the picture, one per spoken line while it is said; `bandHeight` pads the frame for them. */
  captions?: ReadonlyArray<{ file: string; fromMs: number; toMs: number }>;
  bandHeight?: number;
}): NarrationCommand {
  const g = input.geometry;
  const dur = sec(input.durationMs);
  const halo = input.pulse
    ? `[2:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(0.55+0.45*sin(2*PI*${PULSE_HZ}*T))'[halo]`
    : `[2:v]format=rgba[halo]`;
  // The picture: cut to its moments when asked, then padded above for the address strip.
  const bars = input.bars ?? [];
  const barH = bars.length > 0 ? (input.barHeight ?? URL_BAR.height) : 0;
  const captions = input.captions ?? [];
  const bandH = input.bandHeight ?? (captions.length > 0 ? CAPTION_BAND.height : 0);
  const base = [
    input.cut ? `select='${input.cut}',setpts=N/FRAME_RATE/TB` : null,
    barH + bandH > 0 ? `pad=iw:ih+${barH + bandH}:0:${barH}:color=0x1b1b1f` : null,
  ].filter((f): f is string => f !== null);
  const parts: string[] = [
    `[1:v]format=rgba[bub]`,
    halo,
    `[0:v]${base.length > 0 ? base.join(',') : 'null'}[vbase]`,
  ];
  const n = input.clips.length;
  let last = '[vbase]';
  bars.forEach((b, i) => {
    const out = `[vb${i}]`;
    parts.push(`${last}[${3 + n + i}:v]overlay=x=0:y=0:enable='between(t,${sec(b.fromMs)},${sec(b.toMs)})'${out}`);
    last = out;
  });
  // The subtitles sit in the band, below the (padded) picture: y = bar + picture height, read from the frame itself.
  captions.forEach((c, i) => {
    const out = `[vc${i}]`;
    parts.push(`${last}[${3 + n + bars.length + i}:v]overlay=x=0:y=main_h-overlay_h:enable='between(t,${sec(c.fromMs)},${sec(c.toMs)})'${out}`);
    last = out;
  });
  parts.push(
    `${last}[halo]overlay=x=${g.haloX}:y=${g.haloY}:enable='${speakingExpr(input.placed)}':shortest=1[v1]`,
    `[v1][bub]overlay=x=${g.x}:y=${g.y}:shortest=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]`,
  );
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
    ...bars.flatMap(b => ['-loop', '1', '-i', b.file]),
    ...captions.flatMap(c => ['-loop', '1', '-i', c.file]),
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

/**
 * THE DEMO CUT (Chris, 2026-10-04: "pace of the demo could be a touch faster"). A demo is
 * recorded live: between one spoken step and the next the agent is thinking, and the page sits
 * still for ten seconds. The cut keeps the moments that carry the story — each spoken line with
 * a little room around it, each action with the second after it — and shortens every idle
 * stretch longer than {@link CUT.maxGapMs} to its last {@link CUT.keepBeforeMs}, so the state
 * before the next step is still seen. Times in the result are the cut video's; `remap` carries a
 * source time across. Pure: the ffmpeg half is `narrationCommand`.
 */
export const CUT = {
  /** Room kept before a spoken line starts. */
  leadMs: 300,
  /** Room kept after a spoken line ends. */
  tailMs: 400,
  /** Room kept before an action. */
  actionLeadMs: 200,
  /** Room kept after an action, for the page to show what it did. */
  actionTailMs: 600,
  /** An idle stretch shorter than this is left alone. */
  maxGapMs: 800,
  /** Of a longer idle stretch, this much before the next moment is kept. */
  keepBeforeMs: 500,
} as const;

export type CutSegment = { fromMs: number; toMs: number; /** Where this segment starts in the cut video. */ startMs: number };

export type DemoCut = {
  segments: CutSegment[];
  /** The cut video's length. */
  durationMs: number;
  /** A source time, in the cut video's clock; a time inside a dropped stretch lands on the next segment's start. */
  remap: (sourceMs: number) => number;
  /** ffmpeg's `select` expression for the kept frames (seconds). */
  selectExpr: string;
};

/**
 * Plan the cut from what the recording shows (`timeline` moments) and the spoken lines placed on
 * it. A video with no actions and no lines is kept whole.
 * @param moments - The recording's logged moments (actions, page reads), source times.
 * @param lines - The spoken lines as placed on the source video.
 * @param videoMs - The source video's length.
 */
export function demoCut(moments: ReadonlyArray<{ atMs: number }>, lines: ReadonlyArray<{ startMs: number; endMs: number }>, videoMs: number): DemoCut {
  const clamp = (n: number) => Math.max(0, Math.min(videoMs, Math.round(n)));
  const windows = [
    ...lines.map(l => ({ from: clamp(l.startMs - CUT.leadMs), to: clamp(l.endMs + CUT.tailMs) })),
    ...moments.filter(m => Number.isFinite(m.atMs)).map(m => ({ from: clamp(m.atMs - CUT.actionLeadMs), to: clamp(m.atMs + CUT.actionTailMs) })),
  ].filter(w => w.to > w.from).sort((a, b) => a.from - b.from);
  if (windows.length === 0) {
    return { segments: [{ fromMs: 0, toMs: videoMs, startMs: 0 }], durationMs: videoMs, remap: t => clamp(t), selectExpr: `between(t,${sec(0)},${sec(videoMs)})` };
  }
  // Merge what overlaps or nearly touches; a short idle stretch stays in.
  const merged: Array<{ from: number; to: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.from - last.to <= CUT.maxGapMs) {
      last.to = Math.max(last.to, w.to);
    } else {
      merged.push({ ...w });
    }
  }
  // Of each longer stretch, keep the moment just before the next window: the state the next step acts on.
  const kept: Array<{ from: number; to: number }> = [];
  for (const [i, w] of merged.entries()) {
    const from = i === 0 ? w.from : Math.max(merged[i - 1]!.to, w.from - CUT.keepBeforeMs);
    kept.push({ from, to: w.to });
  }
  let cursor = 0;
  const segments: CutSegment[] = kept.map((k) => {
    const seg = { fromMs: k.from, toMs: k.to, startMs: cursor };
    cursor += k.to - k.from;
    return seg;
  });
  const durationMs = cursor;
  const remap = (sourceMs: number): number => {
    const t = clamp(sourceMs);
    for (const s of segments) {
      if (t < s.fromMs) {
        return s.startMs;
      }
      if (t <= s.toMs) {
        return s.startMs + (t - s.fromMs);
      }
    }
    return durationMs;
  };
  return { segments, durationMs, remap, selectExpr: segments.map(s => `between(t,${sec(s.fromMs)},${sec(s.toMs)})`).join('+') };
}

/** The address strip above the picture: its height, and what the bar shows of a URL. */

/**
 * The address shown for a page: host and path, no scheme, no query noise beyond what fits.
 * @param url - The page's URL.
 */
export function addressOf(url: string): string {
  try {
    const u = new URL(url);
    const text = `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
    return text.length > URL_BAR.maxChars ? `${text.slice(0, URL_BAR.maxChars - 1)}…` : text;
  } catch {
    return url.slice(0, URL_BAR.maxChars);
  }
}

/**
 * The address the bar shows over time: one span per stretch the page sat at one address, from
 * the moments that carried a URL, in the cut video's clock.
 * @param moments - The recording's logged moments with their page URL.
 * @param remap - Source time to cut time (`DemoCut.remap`), or identity.
 * @param durationMs - The (cut) video's length.
 */
export function addressSpans(moments: ReadonlyArray<{ atMs: number; url?: string | null }>, remap: (ms: number) => number, durationMs: number): Array<{ address: string; fromMs: number; toMs: number }> {
  const withUrl = moments.filter(m => typeof m.url === 'string' && m.url && Number.isFinite(m.atMs)).sort((a, b) => a.atMs - b.atMs);
  const spans: Array<{ address: string; fromMs: number; toMs: number }> = [];
  for (const m of withUrl) {
    const address = addressOf(m.url!);
    const at = remap(m.atMs);
    const last = spans[spans.length - 1];
    if (last && last.address === address) {
      continue;
    }
    if (last) {
      last.toMs = at;
    }
    spans.push({ address, fromMs: spans.length === 0 ? 0 : at, toMs: durationMs });
  }
  return spans.filter(s => s.toMs > s.fromMs);
}

/**
 * The address bar as an SVG the narration rasterises: a dark strip the width of the video,
 * a rounded field, the address in a plain face.
 * @param width - The video's width.
 * @param address - What it shows.
 */
export function addressBarSvg(width: number, address: string): string {
  const h = URL_BAR.height;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">
  <rect width="${width}" height="${h}" fill="#1b1b1f"/>
  <circle cx="22" cy="${h / 2}" r="5.5" fill="#fe5f57"/><circle cx="40" cy="${h / 2}" r="5.5" fill="#febc2e"/><circle cx="58" cy="${h / 2}" r="5.5" fill="#28c840"/>
  <rect x="84" y="7" width="${width - 168}" height="${h - 14}" rx="7" fill="#2b2b31"/>
  <text x="${width / 2}" y="${h / 2 + 5}" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif" font-size="14" fill="#d7d7dc">${esc(address)}</text>
</svg>`;
}
