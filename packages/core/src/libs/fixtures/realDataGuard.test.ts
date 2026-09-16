import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_NAMES, hashTerm, MAX_BANNED_WORDS, normalizeForScan, REAL_DATA_SHAPES } from './realDataGuard';

/**
 * The repo is public, and until 2026-09 it carried real customers, prospects,
 * contacts, venues, domains and live CRM/Zoom/Clerk ids as fixture data. This
 * test is what stops any of them returning: it reads every tracked file — the
 * contents AND the path, because a screenshot can carry a name in its filename
 * — and fails with the file and line.
 *
 * It enforces both halves of `realDataGuard.ts`:
 *
 *   1. `BANNED_NAMES` — the specific identities that were removed, by hash.
 *   2. `REAL_DATA_SHAPES` — classes of real-world value that are not names, by
 *      pattern, so a *different* real recording URL or org id pasted next week
 *      is caught too.
 *
 * It is a test rather than a lint rule on purpose. A lint rule can be silenced
 * with an inline comment by whoever is adding the value; this cannot.
 *
 * See `realDataGuard.ts` for both lists, why each entry is on them, and the
 * fixture cast to use instead.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

/** Never worth scanning: build output, vendored code, binaries. */
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'llm-cache',
  'node_modules',
  'playwright-report',
  'storybook-static',
  'test-results',
  'vitest-test-results',
]);

/**
 * Binary formats. Their PATHS are still scanned — a leaked name in a screenshot
 * filename is exactly the case this catches — but their bytes are not text.
 */
const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|pdf|mp4|mov|zip|gz|tgz|wasm)$/i;

/**
 * Files allowed to contain a banned term. Keep this empty if you can: an
 * exception is a place the name still exists. Each entry needs a comment.
 */
const ALLOWED: ReadonlySet<string> = new Set<string>([]);

/**
 * Files exempt from the SHAPE rules only — never from `BANNED_NAMES`.
 * Each entry needs a comment saying why the shape is a false positive there.
 */
const SHAPE_ALLOWED: ReadonlySet<string> = new Set<string>([
  // Declares the patterns themselves, so it necessarily contains them.
  'packages/core/src/libs/fixtures/realDataGuard.ts',
  'packages/core/src/libs/fixtures/realDataGuard.test.ts',
]);

const HEADS = new Set(BANNED_NAMES.map(b => b.head));
const BY_HASH = new Map(BANNED_NAMES.map(b => [b.hash, b]));

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile()) {
      yield full;
    }
  }
}

/**
 * Every banned term found in one line of text, as `id` strings.
 *
 * Tokenises the normalised line, then — only for tokens whose hash is a known
 * first word — tries the 1..MAX_BANNED_WORDS n-grams starting there. The
 * prefilter is what keeps a whole-repo scan under a second.
 * @param text - One line of file content, or a repo-relative path.
 */
export function bannedTermsIn(text: string): string[] {
  const words = normalizeForScan(text).split(' ');
  const hits: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '' || !HEADS.has(hashTerm(word))) {
      continue;
    }
    for (let n = 1; n <= MAX_BANNED_WORDS && i + n <= words.length; n++) {
      const found = BY_HASH.get(hashTerm(words.slice(i, i + n).join(' ')));
      if (found) {
        hits.push(found.id);
      }
    }
  }
  return hits;
}

/**
 * Every real-data SHAPE found in one line, as `id` strings.
 * @param text - One line of file content.
 */
export function realDataShapesIn(text: string): string[] {
  const hits: string[] = [];
  for (const shape of REAL_DATA_SHAPES) {
    for (const match of text.matchAll(new RegExp(shape.pattern.source, `${shape.pattern.flags.replace('g', '')}g`))) {
      if (!shape.allow.some(ok => ok.test(match[0]))) {
        hits.push(shape.id);
        break;
      }
    }
  }
  return hits;
}

describe('no real customer, contact or live-account identifier is committed', () => {
  it('anywhere in the repository — file contents or file names', () => {
    const offenders: string[] = [];

    for (const file of walk(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file).split(sep).join('/');
      if (ALLOWED.has(rel)) {
        continue;
      }

      for (const id of bannedTermsIn(rel)) {
        offenders.push(`${rel}: banned name in the file path [${id}]`);
      }

      if (BINARY.test(rel)) {
        continue;
      }

      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\0')) {
        continue; // binary with a text-ish extension
      }

      const shapesApply = !SHAPE_ALLOWED.has(rel);
      text.split('\n').forEach((line, i) => {
        for (const id of bannedTermsIn(line)) {
          offenders.push(`${rel}:${i + 1}: banned name [${id}] — see packages/core/src/libs/fixtures/realDataGuard.ts`);
        }
        if (shapesApply) {
          for (const id of realDataShapesIn(line)) {
            offenders.push(`${rel}:${i + 1}: real-data shape [${id}] — see packages/core/src/libs/fixtures/realDataGuard.ts`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('detects a banned term the scanner is pointed at', () => {
    // Proves the scan is live rather than vacuously passing. `scan-sentinel`
    // is a made-up token that exists only for this: written to a temp file
    // OUTSIDE the repo, so the scan above never sees it.
    const dir = mkdtempSync(join(tmpdir(), 'banned-names-'));
    const file = join(dir, 'sample.txt');
    const sentinel = ['zz', 'scrub', 'sentinel', 'zz'].join('');
    writeFileSync(file, `harmless line\nsomething ${sentinel} here\n`, 'utf8');

    const hits = readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => bannedTermsIn(line).map(id => `${i + 1}:${id}`));

    expect(hits).toEqual(['2:scan-sentinel']);
    // and the same term in a path, which is how a screenshot filename is caught
    expect(bannedTermsIn(`deliverables/sheet-${sentinel}-1440.png`)).toEqual(['scan-sentinel']);
  });

  it('catches a real-data shape it has never seen before', () => {
    // The point of the shape rules: none of these values ever appeared in this
    // repo, and all of them are caught anyway.
    const zoomHost = ['us', '02', 'web.zoom.us'].join('');

    expect(realDataShapesIn(`link: 'https://${zoomHost}/rec/share/aBcD_1234-efGH5678.xyz9'`)).toEqual(['meeting-recording-url']);
    expect(realDataShapesIn(`orgId: 'org_9QwErTyUiOpAsDfGhJkLzXcVb'`)).toEqual(['provider-org-id']);
    expect(realDataShapesIn(`<p>Ph (617) 421-9008</p>`)).toEqual(['north-american-phone']);
    expect(realDataShapesIn(`streetAddress: '4417 Kingsbury Ave'`)).toEqual(['street-address']);
  });

  it('lets an obviously synthetic value of each shape through', () => {
    expect(realDataShapesIn(`link: 'https://zoom.example/rec/play/EXAMPLE-RECORDING-TOKEN'`)).toEqual([]);
    expect(realDataShapesIn(`shareUrl: 'https://zoom.example/rec/share/seed-discovery-1'`)).toEqual([]);
    expect(realDataShapesIn(`orgId: 'org_2ExampleFixtureOrgId000000'`)).toEqual([]);
    expect(realDataShapesIn(`phone: '802-555-0142'`)).toEqual([]);
    expect(realDataShapesIn(`<p>Ph (802) 555-0142</p>`)).toEqual([]);
    expect(realDataShapesIn(`streetAddress: '88 Mill Street'`)).toEqual([]);
  });

  it('keeps every shape rule explained and allow-listed', () => {
    for (const shape of REAL_DATA_SHAPES) {
      expect(shape.why.length, `${shape.id} needs a why`).toBeGreaterThan(20);
      expect(shape.pattern.flags, `${shape.id} must not carry its own /g`).not.toContain('g');
      expect(shape.allow.length, `${shape.id} needs at least one synthetic form`).toBeGreaterThan(0);
    }

    expect(new Set(REAL_DATA_SHAPES.map(s => s.id)).size).toBe(REAL_DATA_SHAPES.length);
  });

  it('keeps every entry explained', () => {
    for (const entry of BANNED_NAMES) {
      expect(entry.why.length, `${entry.id} needs a why`).toBeGreaterThan(20);
      expect(entry.words).toBeLessThanOrEqual(MAX_BANNED_WORDS);
      expect(entry.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.head).toMatch(/^[0-9a-f]{16}$/);
    }

    expect(new Set(BANNED_NAMES.map(b => b.id)).size).toBe(BANNED_NAMES.length);
  });
});
