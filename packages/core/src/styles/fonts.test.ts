import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_PRELOADS } from './fontPreloads';

/**
 * NO BUILD FETCHES A FONT (2026-10-09). `next/font/google` downloaded every
 * face from fonts.googleapis.com during `next build`, and that failing broke
 * CI, a release image and a merge to main. The faces are committed under
 * `public/fonts` and declared in `styles/fonts.css`.
 */

const CORE = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(__dirname, 'fonts.css'), 'utf8');

describe('self-hosted fonts', () => {
  it('nothing imports next/font/google', () => {
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-l', '-e', 'next/font/google\'', '-e', 'next/font/google"', '--', 'src', ':!src/styles/fonts.test.ts'], { cwd: CORE, encoding: 'utf8' }).trim();
    } catch {
      // git grep exits 1 when nothing matches.
    }

    expect(hits).toBe('');
  });

  it('declares every face from a committed file, never a remote one', () => {
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]!);

    expect(urls.length).toBeGreaterThan(30);
    expect(urls.filter(u => !u.startsWith('/fonts/'))).toEqual([]);
    expect(urls.filter(u => !existsSync(path.join(CORE, 'public', u)))).toEqual([]);
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('keeps the variables the app reads, each with its metric-adjusted fallback', () => {
    for (const v of ['--font-outfit', '--font-inter', '--font-barlow', '--font-manrope', '--font-space-grotesk', '--font-ibm-plex-sans', '--font-fraunces', '--font-source-serif-4']) {
      expect(css).toMatch(new RegExp(`${v}: '[^']+', '[^']+ Fallback';`));
    }

    expect(css.match(/size-adjust:/g)?.length).toBe(8);
  });

  it('preloads the faces every page uses, from disk', () => {
    expect(FONT_PRELOADS).toEqual(['/fonts/outfit/outfit-latin.woff2', '/fonts/inter/inter-latin.woff2']);

    for (const href of FONT_PRELOADS) {
      expect(existsSync(path.join(CORE, 'public', href))).toBe(true);
    }
  });

  it('ships each family with its licence', () => {
    for (const dir of ['outfit', 'inter', 'barlow', 'manrope', 'space-grotesk', 'ibm-plex-sans', 'fraunces', 'source-serif-4']) {
      expect(readFileSync(path.join(CORE, 'public', 'fonts', dir, 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });
});
