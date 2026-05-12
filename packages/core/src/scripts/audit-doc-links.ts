/**
 * docs:lint — broken-link checker for the markdown docs corpus.
 *
 * Walks every `.md` in `docs/`, `requirements/`, plus root `README.md`,
 * extracts relative + absolute markdown links, and reports any that
 * point at a non-existent file. External links (http/https/mailto) are
 * not checked.
 *
 * Exits non-zero if any broken link is found, so it's safe to wire
 * into CI.
 *
 * Usage:
 *
 *   npm run docs:lint
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { listDocs } from '../libs/docs';
import { getRepoRoot } from '../libs/repo-root';

const ROOT = getRepoRoot();

type Issue = { file: string; line: number; link: string; reason: string };

function extractLinks(content: string): Array<{ href: string; line: number }> {
  // Match `[text](href)` — non-greedy on text, anchored on a real
  // closing-paren outside a code fence. Good enough for >99% of cases.
  const lines = content.split('\n');
  const out: Array<{ href: string; line: number }> = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(line)) !== null) {
      const href = (m[2] ?? '').trim();
      if (href) {
        out.push({ href, line: i + 1 });
      }
    }
  }
  return out;
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(href);
}

function stripAnchor(href: string): string {
  return href.split('#')[0] ?? href;
}

async function main() {
  const entries = listDocs({ kind: 'all' });
  const issues: Issue[] = [];

  for (const entry of entries) {
    const abs = join(ROOT, entry.path);
    const content = await (await import('node:fs/promises')).readFile(abs, 'utf-8');
    const links = extractLinks(content);
    const dir = dirname(abs);

    for (const { href, line } of links) {
      if (isExternal(href)) {
        continue;
      }
      const target = stripAnchor(href);
      if (!target) {
        continue;
      }
      const resolved = target.startsWith('/')
        ? resolve(ROOT, target.slice(1))
        : resolve(dir, target);
      // Allow links to URL routes that don't map to .md files
      // (e.g. /dashboard/agents). Heuristic: only flag links that
      // explicitly point at a `.md` file or end in `/`.
      const looksLikeMarkdown = target.endsWith('.md') || target.endsWith('/');
      if (!looksLikeMarkdown) {
        continue;
      }
      if (!existsSync(resolved)) {
        issues.push({ file: entry.path, line, link: href, reason: 'target not found' });
      }
    }
  }

  if (issues.length === 0) {
    console.log(`[docs:lint] ok — checked ${entries.length} files, no broken links`);
    return;
  }

  console.error(`[docs:lint] ${issues.length} broken links:`);
  for (const i of issues) {
    console.error(`  ${i.file}:${i.line}  ${i.link}  (${i.reason})`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('[docs:lint] FAILED:', (err as Error).message);
  process.exit(2);
});
