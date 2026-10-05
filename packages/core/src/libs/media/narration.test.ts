import { describe, expect, it } from 'vitest';
import { accentHex, accentRgba, bubbleGeometry, CAPTION_BAND, captionLeft, captionSvg, DEMO_ACCENT, initialsBubbleSvg, initialsOf, MIN_TAIL_MS, narrationCommand, placeLines, speakingExpr, vocionMarkBubbleSvg } from './narration';

describe('placeLines — where each line is spoken', () => {
  it('starts each line at its moment, after the one before when they would overlap', () => {
    const { placed, dropped } = placeLines([
      { atMs: 1_000, text: 'Opens the room.', durationMs: 2_000 },
      { atMs: 2_000, text: 'Clicks Export.', durationMs: 1_500 },
      { atMs: 9_000, text: 'The PDF downloads.', durationMs: 2_000 },
    ], 20_000, 250);

    expect(dropped).toBe(0);
    expect(placed.map(p => [p.startMs, p.endMs])).toEqual([[1_000, 3_000], [3_250, 4_750], [9_000, 11_000]]);
  });

  it('speaks in time order whatever order the lines were written in', () => {
    const { placed } = placeLines([
      { atMs: 5_000, text: 'second', durationMs: 1_000 },
      { atMs: 0, text: 'first', durationMs: 1_000 },
    ], 10_000);

    expect(placed.map(p => p.text)).toEqual(['first', 'second']);
    expect(placed.map(p => p.index)).toEqual([1, 0]);
  });

  it('drops a line that cannot start before the video ends, and cuts the last one at the end', () => {
    const { placed, dropped } = placeLines([
      { atMs: 0, text: 'a', durationMs: 4_000 },
      { atMs: 1_000, text: 'b', durationMs: 4_000 },
      { atMs: 2_000, text: 'c', durationMs: 4_000 },
    ], 6_000, 0);

    expect(placed.map(p => p.text)).toEqual(['a', 'b']);
    expect(placed[1]).toMatchObject({ startMs: 4_000, endMs: 6_000, durationMs: 2_000 });
    expect(dropped).toBe(1);
    expect(placed.every(p => p.startMs <= 6_000 - MIN_TAIL_MS)).toBe(true);
  });

  it('never starts before zero, and ignores empty lines and silent clips', () => {
    const { placed, dropped } = placeLines([
      { atMs: -500, text: 'early', durationMs: 1_000 },
      { atMs: 100, text: '   ', durationMs: 1_000 },
      { atMs: 200, text: 'silent', durationMs: 0 },
    ], 5_000);

    expect(placed).toHaveLength(1);
    expect(placed[0]!.startMs).toBe(0);
    expect(dropped).toBe(2);
  });
});

describe('bubbleGeometry — 18% of the shorter side, bottom-left', () => {
  it('sizes and places the bubble on a desktop recording', () => {
    const g = bubbleGeometry(1440, 900);

    expect(g.size).toBe(162);
    expect(g.size % 2).toBe(0);
    expect(g.halo).toBeGreaterThan(g.size);
    expect(g.x).toBeGreaterThan(0);
    expect(g.y + g.size).toBeLessThan(900);
    // The ring is centred on the bubble and inside the frame.
    expect(g.haloX + g.halo / 2).toBeCloseTo(g.x + g.size / 2, 0);
    expect(g.haloX).toBeGreaterThanOrEqual(0);
    expect(g.haloY + g.halo).toBeLessThanOrEqual(900);
  });

  it('uses the width on a phone recording', () => {
    expect(bubbleGeometry(390, 844).size).toBe(70);
  });
});

describe('the bubble\'s face', () => {
  it('takes two initials from a name', () => {
    expect(initialsOf('Quality Assurance')).toBe('QA');
    expect(initialsOf('QA')).toBe('QA');
    expect(initialsOf('change-reviewer')).toBe('CR');
    expect(initialsOf('Designer')).toBe('DE');
    expect(initialsOf('  ')).toBe('?');
  });

  it('turns an accent into a color, amber when unknown', () => {
    expect(accentHex('emerald')).toBe('#059669');
    expect(accentHex('#0f8a7e')).toBe('#0F8A7E');
    expect(accentHex('#abc')).toBe('#AABBCC');
    expect(accentHex('mauve')).toBe('#F18700');
    expect(accentHex(null)).toBe('#F18700');
  });

  it('escapes what it draws', () => {
    const svg = initialsBubbleSvg(100, '<&', '#059669');

    expect(svg).toContain('&lt;&amp;');
    expect(svg).not.toContain('<&');
  });
});

describe('narrationCommand — the one ffmpeg pass', () => {
  const placed = [
    { index: 0, text: 'a', startMs: 1_000, endMs: 2_500, durationMs: 1_500 },
    { index: 1, text: 'b', startMs: 4_000, endMs: 5_000, durationMs: 1_000 },
  ];
  const base = { video: 'in.webm', bubble: 'b.png', halo: 'h.png', clips: ['l0.mp3', 'l1.mp3'], placed, geometry: bubbleGeometry(1440, 900), durationMs: 8_000, out: 'out.mp4', mp4: true, pulse: true };

  it('shows the ring only while a line is spoken, pulsing', () => {
    const { filter } = narrationCommand(base);

    expect(speakingExpr(placed)).toBe('between(t,1.000,2.500)+between(t,4.000,5.000)');
    expect(filter).toContain(`enable='between(t,1.000,2.500)+between(t,4.000,5.000)'`);
    expect(filter).toContain('geq=');
    expect(filter).toContain('sin(2*PI*');
  });

  it('delays each line to its start, mixes without normalising, and fits the soundtrack to the video', () => {
    const { filter, args } = narrationCommand(base);

    expect(filter).toContain('[3:a]aresample=44100,adelay=delays=1000:all=1[a0]');
    expect(filter).toContain('[4:a]aresample=44100,adelay=delays=4000:all=1[a1]');
    expect(filter).toContain('amix=inputs=2:normalize=0:duration=longest,apad,atrim=end=8.000[aout]');
    expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '8.000']);
    expect(args).toContain('libx264');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('places the bubble where the geometry says, with one clip and no pulse', () => {
    const g = bubbleGeometry(390, 844);
    const { filter, args } = narrationCommand({ ...base, geometry: g, clips: ['l0.mp3'], placed: [placed[0]!], pulse: false, mp4: false, out: 'out.webm' });

    expect(filter).toContain(`overlay=x=${g.x}:y=${g.y}`);
    expect(filter).not.toContain('geq=');
    expect(filter).toContain('[a0]apad,atrim=end=8.000[aout]');
    expect(args).toContain('libvpx');
  });
});

describe('the demo cut (Chris, 2026-10-04: "pace of the demo could be a touch faster")', () => {
  it('keeps each spoken line and each action with a little room, shortens long idle stretches, and remaps times', async () => {
    const { CUT, demoCut } = await import('./narration');
    // Two lines ten seconds apart; the page sat still between them.
    const cut = demoCut([{ atMs: 4_000 }, { atMs: 15_000 }], [{ startMs: 4_400, endMs: 8_400 }, { startMs: 15_200, endMs: 19_000 }], 30_000);

    expect(cut.segments).toEqual([
      { fromMs: 3_800, toMs: 8_800, startMs: 0 },
      // The second window starts at the action (15,000 − 200); 500 ms before it is kept.
      { fromMs: 14_300, toMs: 19_400, startMs: 5_000 },
    ]);
    expect(cut.durationMs).toBe(10_100);
    expect(cut.remap(4_400)).toBe(600);
    expect(cut.remap(12_000)).toBe(5_000);
    expect(cut.remap(15_200)).toBe(5_900);
    expect(cut.remap(29_000)).toBe(10_100);
    expect(cut.selectExpr).toBe('between(t,3.800,8.800)+between(t,14.300,19.400)');
    expect(CUT.maxGapMs).toBeLessThan(5_000);
  });

  it('leaves a short idle stretch in, and keeps a video with nothing logged whole', async () => {
    const { demoCut } = await import('./narration');

    expect(demoCut([{ atMs: 1_000 }, { atMs: 2_500 }], [], 10_000).segments).toEqual([{ fromMs: 800, toMs: 3_400, startMs: 0 }]);
    expect(demoCut([], [], 10_000)).toMatchObject({ durationMs: 10_000, selectExpr: 'between(t,0.000,10.000)' });
  });

  it('shows one address per stretch the page sat at it, in the cut clock, and spells an address plainly', async () => {
    const { addressBarSvg, addressOf, addressSpans } = await import('./narration');
    const moments = [
      { atMs: 1_000, url: 'https://app.northwind.example/' },
      { atMs: 1_500, url: 'https://app.northwind.example/' },
      { atMs: 9_000, url: 'https://app.northwind.example/documents/42?tab=views' },
    ];

    expect(addressSpans(moments, ms => ms / 2, 6_000)).toEqual([
      { address: 'app.northwind.example', fromMs: 0, toMs: 4_500 },
      { address: 'app.northwind.example/documents/42?tab=views', fromMs: 4_500, toMs: 6_000 },
    ]);
    expect(addressOf('not a url')).toBe('not a url');
    expect(addressBarSvg(1440, 'app.northwind.example/<x>')).toContain('app.northwind.example/&lt;x&gt;');
  });

  it('puts the cut and the bars into the command: select before the overlays, a padded frame, each bar on its stretch', async () => {
    const { bubbleGeometry, narrationCommand } = await import('./narration');
    const cmd = narrationCommand({ video: 'v.webm', bubble: 'b.png', halo: 'h.png', clips: ['l0.mp3'], placed: [{ index: 0, text: 'hi', startMs: 600, endMs: 2_000, durationMs: 1_400 }], geometry: bubbleGeometry(1440, 940), durationMs: 10_100, out: 'o.mp4', mp4: true, pulse: false, cut: 'between(t,3.800,8.800)+between(t,14.300,19.400)', bars: [{ file: 'bar-0.png', fromMs: 0, toMs: 4_500 }, { file: 'bar-1.png', fromMs: 4_500, toMs: 10_100 }], barHeight: 40 });

    expect(cmd.filter).toContain(`[0:v]select='between(t,3.800,8.800)+between(t,14.300,19.400)',setpts=N/FRAME_RATE/TB,pad=iw:ih+40:0:40:color=0x1b1b1f[vbase]`);
    expect(cmd.filter).toContain(`[vbase][4:v]overlay=x=0:y=0:enable='between(t,0.000,4.500)'[vb0]`);
    expect(cmd.filter).toContain(`[vb0][5:v]overlay=x=0:y=0:enable='between(t,4.500,10.100)'[vb1]`);
    expect(cmd.filter).toContain('[vb1][halo]overlay');
    expect(cmd.args.join(' ')).toContain('-i l0.mp3 -loop 1 -i bar-0.png -loop 1 -i bar-1.png');
  });
});

describe('the band below the picture (Chris, 2026-10-04: the bubble covered a row title)', () => {
  it('puts the bubble in the band, at the left, never over the picture', () => {
    const g = bubbleGeometry(1440, 940, CAPTION_BAND.height);

    expect(g.y).toBeGreaterThanOrEqual(940);
    expect(g.y + g.size).toBeLessThanOrEqual(940 + CAPTION_BAND.height);
    expect(g.haloY).toBeGreaterThanOrEqual(940);
    expect(g.haloY + g.halo).toBeLessThanOrEqual(940 + CAPTION_BAND.height);
    expect(captionLeft(g)).toBeGreaterThan(g.haloX + g.halo);
    // Without a band the old bottom-left placement stands.
    expect(bubbleGeometry(1440, 900)).toEqual(bubbleGeometry(1440, 900, 0));
  });

  it('draws the spoken line in the band, wrapped to two lines and cut with an ellipsis past that', () => {
    const svg = captionSvg(1440, 'I upload the board deck and set it to stop after two opens.', 200);

    expect(svg).toContain(`height="${CAPTION_BAND.height}"`);
    expect(svg).toContain('x="200"');
    expect(svg).toContain('I upload the board deck and set it to stop after two opens.');

    const long = captionSvg(600, Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '), 150);

    expect((long.match(/<text/g) ?? []).length).toBe(2);
    expect(long).toContain('…');
  });

  it('pads the frame for the band and shows each caption while its line is said', () => {
    const placed = [{ index: 0, text: 'hi', startMs: 600, endMs: 2_000, durationMs: 1_400 }, { index: 1, text: 'two', startMs: 2_400, endMs: 4_000, durationMs: 1_600 }];
    const cmd = narrationCommand({ video: 'v.webm', bubble: 'b.png', halo: 'h.png', clips: ['l0.mp3', 'l1.mp3'], placed, geometry: bubbleGeometry(1440, 900, CAPTION_BAND.height), durationMs: 5_000, out: 'o.mp4', mp4: true, pulse: false, captions: [{ file: 'c0.png', fromMs: 600, toMs: 2_000 }, { file: 'c1.png', fromMs: 2_400, toMs: 4_000 }], bandHeight: CAPTION_BAND.height });

    expect(cmd.filter).toContain(`pad=iw:ih+${CAPTION_BAND.height}:0:0:color=0x1b1b1f[vbase]`);
    expect(cmd.filter).toContain(`[vbase][5:v]overlay=x=0:y=main_h-overlay_h:enable='between(t,0.600,2.000)'[vc0]`);
    expect(cmd.filter).toContain(`[vc0][6:v]overlay=x=0:y=main_h-overlay_h:enable='between(t,2.400,4.000)'[vc1]`);
    expect(cmd.filter).toContain('[vc1][halo]overlay');
    expect(cmd.args.join(' ')).toContain('-i l1.mp3 -loop 1 -i c0.png -loop 1 -i c1.png');
  });
});

describe('the Vocion mark and the one accent (Chris, 2026-10-04)', () => {
  it('draws the mark on Vocion Ink with the two gradient rails and a white rim', () => {
    const svg = vocionMarkBubbleSvg(120);

    expect(svg).toContain('fill="#0B1020"');
    expect(svg).toContain('stroke="url(#l)"');
    expect(svg).toContain('stroke="url(#r)"');
    expect(svg).toContain('stroke="#FFFFFF"');
    expect(svg).not.toMatch(/QA/);
  });

  it('spells the accent as rgba for CSS', () => {
    expect(DEMO_ACCENT).toBe('#4D63FF');
    expect(accentRgba(0.18)).toBe('rgba(77,99,255,0.18)');
  });
});
