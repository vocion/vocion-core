import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Review is not a destination any more. The only CODE allowed to name
 * `/dashboard/review` is the redirect that forwards it (and the pure mapping
 * it calls), plus the chat link classifier that recognises the old shape so a
 * pasted link still becomes a chip. Comments may mention it — saying where a
 * redirect comes from is documentation, not a door. Everything else — the
 * email renderer, ask context URLs, the recommended-action card, Slack
 * replies, the briefing bullets, the object and page views — points at
 * `/dashboard/inbox`. This test keeps it that way.
 */

const ROOT = join(__dirname, '..', '..', '..');

const ALLOWED = new Set([
  'app/[locale]/(auth)/dashboard/review/page.tsx',
  'features/dashboard/inbox/reviewRedirect.ts',
  'features/dashboard/chat/links.ts',
]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') {
        continue;
      }
      yield* walk(full);
    } else if (/\.(?:ts|tsx)$/.test(name) && !/\.(?:test|stories)\.tsx?$/.test(name)) {
      yield full;
    }
  }
}

describe('no /dashboard/review links remain', () => {
  it('outside the redirect and the link classifier', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) {
        continue;
      }
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Prose may name the old path — a comment saying where a redirect
        // comes from is documentation, not a door. Only code counts.
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        if (line.includes('/dashboard/review')) {
          offenders.push(`${rel}:${i + 1}: ${trimmed}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
