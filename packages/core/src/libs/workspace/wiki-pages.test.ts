/**
 * `wiki/<slug>.md` — the pure half of repo-seeded wiki pages: the frontmatter
 * contract, the slug rule, the hash, and the generated index. No database.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceValidationError } from './loader';
import { loadWikiPages, parseWikiPageFile, renderSeededWikiIndex, wikiPageSha } from './wiki-pages';

const dirs: string[] = [];

function workspaceWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-pages-'));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

const VOICE = '---\ntitle: Voice\nsummary: How we sound.\norder: 10\ntags: [voice]\n---\nPlain, short, no exclamation marks.\n';

describe('parseWikiPageFile — the contract', () => {
  it('reads title, summary, order, tags and managed, the trimmed body, the slug from the filename and the sha of the whole file', () => {
    const page = parseWikiPageFile('/ws/wiki/voice.md', VOICE);

    expect(page).toMatchObject({
      slug: 'voice',
      title: 'Voice',
      summary: 'How we sound.',
      order: 10,
      tags: ['voice'],
      managed: true,
      body: 'Plain, short, no exclamation marks.',
      relPath: 'wiki/voice.md',
      sourceFile: '/ws/wiki/voice.md',
    });
    expect(page.sha).toBe(wikiPageSha(VOICE));
    expect(page.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('needs only a title; summary and order are optional, tags default empty, managed defaults true', () => {
    const page = parseWikiPageFile('/ws/wiki/who-is-who.md', '---\ntitle: Who is who\n---\nChris owns the workspace.\n');

    expect(page.summary).toBeUndefined();
    expect(page.order).toBeUndefined();
    expect(page.tags).toEqual([]);
    expect(page.managed).toBe(true);
  });

  it('reads managed: false', () => {
    expect(parseWikiPageFile('/ws/wiki/once.md', '---\ntitle: Once\nmanaged: false\n---\nSeeded once.\n').managed).toBe(false);
  });

  it('hashes CRLF and LF files the same, and a changed summary as a change', () => {
    expect(wikiPageSha(VOICE.replace(/\n/g, '\r\n'))).toBe(wikiPageSha(VOICE));
    expect(wikiPageSha(VOICE.replace('How we sound.', 'How we write.'))).not.toBe(wikiPageSha(VOICE));
  });

  it('refuses a filename that is not a wiki slug, naming the rule', () => {
    expect(() => parseWikiPageFile('/ws/wiki/Who_Is_Who.md', VOICE)).toThrow(WorkspaceValidationError);
    expect(() => parseWikiPageFile('/ws/wiki/2026-plan.md', VOICE)).toThrow(/not a wiki slug/);
  });

  it('refuses a file with no frontmatter, no title, an unknown key or an empty body', () => {
    expect(() => parseWikiPageFile('/ws/wiki/a.md', 'Just prose.\n')).toThrow(/missing YAML frontmatter/);
    expect(() => parseWikiPageFile('/ws/wiki/a.md', '---\nsummary: no title\n---\nBody.\n')).toThrow(/title/);
    expect(() => parseWikiPageFile('/ws/wiki/a.md', '---\ntitle: A\ntitel: typo\n---\nBody.\n')).toThrow(/titel/);
    expect(() => parseWikiPageFile('/ws/wiki/a.md', '---\ntitle: A\n---\n\n')).toThrow(/body is empty/);
    expect(() => parseWikiPageFile('/ws/wiki/a.md', '---\ntitle: A\nsummary: [\n---\nBody.\n')).toThrow(/invalid YAML frontmatter/);
  });

  it('reads the file as written — a {{env.NAME}} token is content, not a template', () => {
    const page = parseWikiPageFile('/ws/wiki/templating.md', '---\ntitle: Templating\n---\nWrite `{{env.CRM_URL}}` in a SKILL.md and apply substitutes it.\n');

    expect(page.body).toContain('{{env.CRM_URL}}');
  });
});

describe('loadWikiPages — the directory', () => {
  it('is empty without a wiki/ directory', () => {
    const files: string[] = [];

    expect(loadWikiPages(workspaceWith({ 'workspace.yaml': 'version: 1\n' }), files)).toEqual([]);
    expect(files).toEqual([]);
  });

  it('reads top-level .md files A–Z, tracks them for the sha, and leaves other files and subdirectories alone', () => {
    const dir = workspaceWith({
      'wiki/voice.md': VOICE,
      'wiki/decisions.md': '---\ntitle: Decisions\n---\nDated sections.\n',
      'wiki/README.txt': 'not a page',
      'wiki/drafts/plan.md': '---\ntitle: Draft\n---\nNot seeded.\n',
    });
    const files: string[] = [];
    const pages = loadWikiPages(dir, files);

    expect(pages.map(p => p.slug)).toEqual(['decisions', 'voice']);
    expect(files).toEqual([join(dir, 'wiki', 'decisions.md'), join(dir, 'wiki', 'voice.md')]);
  });

  it('names the file when one fails the contract', () => {
    const dir = workspaceWith({ 'wiki/bad.md': 'no frontmatter\n' });

    expect(() => loadWikiPages(dir, [])).toThrow(new RegExp(`${join(dir, 'wiki', 'bad.md')}`));
  });
});

describe('renderSeededWikiIndex', () => {
  it('lists pages by order, unordered ones last A–Z, with the frontmatter summary or the fallback, and never itself', () => {
    const pages = [
      parseWikiPageFile('/ws/wiki/zeta.md', '---\ntitle: Zeta\n---\nZeta is last by name.\n'),
      parseWikiPageFile('/ws/wiki/voice.md', VOICE),
      parseWikiPageFile('/ws/wiki/alpha.md', '---\ntitle: Alpha\n---\n# Heading first\n\nAlpha has no order either.\n'),
      parseWikiPageFile('/ws/wiki/who-is-who.md', '---\ntitle: Who is who\norder: 20\nsummary: Who owns what.\n---\nBody.\n'),
      parseWikiPageFile('/ws/wiki/index.md', '---\ntitle: Index\n---\nHand-written.\n'),
    ];
    const out = renderSeededWikiIndex(pages, p => p.body.split('\n\n').at(-1) ?? '');

    expect(out.split('\n').filter(l => l.startsWith('- '))).toEqual([
      '- **Voice** (`voice`) — How we sound.',
      '- **Who is who** (`who-is-who`) — Who owns what.',
      '- **Alpha** (`alpha`) — Alpha has no order either.',
      '- **Zeta** (`zeta`) — Zeta is last by name.',
    ]);
    expect(out).not.toContain('`index`');
  });
});
