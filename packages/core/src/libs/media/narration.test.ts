import { describe, expect, it } from 'vitest';
import { accentHex, bubbleGeometry, initialsBubbleSvg, initialsOf, MIN_TAIL_MS, narrationCommand, placeLines, speakingExpr } from './narration';

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
