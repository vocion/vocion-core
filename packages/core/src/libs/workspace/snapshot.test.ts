/**
 * What an apply collects from a workspace folder to store with the project.
 *
 * The rule under test: exactly the files a runtime read would otherwise open
 * off WORKSPACE_PATH, kept at their folder paths and as authored — and nothing
 * a link smuggles in from outside the folder.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectWorkspaceFiles, MAX_COLLECTED_FILE_BYTES } from './snapshot';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-snapshot-'));
const WS = join(ROOT, 'northwind');
const MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';

function put(rel: string, body: string): void {
  mkdirSync(join(WS, rel, '..'), { recursive: true });
  writeFileSync(join(WS, rel), body);
}

put('workspace.yaml', 'version: 1\norgId: proj_northwind\nname: Northwind\n');
put('skills/write-brief/SKILL.md', '---\nslug: write-brief\nname: Write a brief\ndescription: d\n---\n\nCall {{env.NORTHWIND_API_URL}}/briefs.\n');
put('skills/write-brief/REFERENCE.html', '<p>reference</p>');
put('skills/write-brief/.draft.md', 'not authored yet');
put('playbooks/house-style/SKILL.md', '---\nslug: house-style\nname: House style\ndescription: d\n---\n\nPlain.\n');
put('agents/scout.yaml', 'slug: scout\nname: Scout\nsystemPromptFile: scout.system-prompt.md\n');
put('agents/scout.system-prompt.md', 'You scout.');
put('agents/notes.txt', 'scratch');
put('pages/pipeline.yaml', 'slug: pipeline\ntitle: Pipeline\narchetype: markdown\n');
put('pages/pipeline.md', '# Pipeline');
put('pages/components/registry.tsx', 'export const widgets = {};');
put('wiki/voice.md', 'applied as an artifact, not read off the folder');
put('brand.yaml', 'name: Northwind\nlogos:\n  mark: brand/mark.svg\n  wordmark: ../outside.svg\n  markOnDark: data:image/png;base64,AAAA\n');
put('brand/mark.svg', MARK_SVG);
put('brand/unused.svg', MARK_SVG);
writeFileSync(join(ROOT, 'outside.svg'), MARK_SVG);
writeFileSync(join(ROOT, 'secret.env'), 'DB_PASSWORD=leaked-if-the-guard-is-missing\n');
symlinkSync(join(ROOT, 'secret.env'), join(WS, 'skills', 'write-brief', 'linked.md'));
put('playbooks/huge/SKILL.md', '---\nslug: huge\nname: Huge\ndescription: d\n---\n\nbody\n');
writeFileSync(join(WS, 'playbooks', 'huge', 'dump.csv'), '');
truncateSync(join(WS, 'playbooks', 'huge', 'dump.csv'), MAX_COLLECTED_FILE_BYTES + 1);

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('collectWorkspaceFiles', () => {
  const collected = collectWorkspaceFiles(WS);
  const byPath = new Map(collected.files.map(f => [f.path, f]));

  it('collects exactly what a runtime read asks for, at its folder path', () => {
    expect([...byPath.keys()]).toEqual([
      'agents/scout.system-prompt.md',
      'agents/scout.yaml',
      'brand.yaml',
      'brand/mark.svg',
      'pages/pipeline.md',
      'pages/pipeline.yaml',
      'playbooks/house-style/SKILL.md',
      'playbooks/huge/SKILL.md',
      'skills/write-brief/REFERENCE.html',
      'skills/write-brief/SKILL.md',
      'workspace.yaml',
    ]);
  });

  it('keeps text as authored — tokens stay tokens — with the sha of its bytes', () => {
    const body = byPath.get('skills/write-brief/SKILL.md')!;

    expect(body.content).toContain('{{env.NORTHWIND_API_URL}}/briefs');
    expect(body.encoding).toBe('utf8');
    expect(body.sha).toBe(createHash('sha256').update(body.content).digest('hex'));
  });

  it('stores the logo the brand names as base64, and no logo it does not name or that sits outside the folder', () => {
    const mark = byPath.get('brand/mark.svg')!;

    expect(mark.encoding).toBe('base64');
    expect(Buffer.from(mark.content, 'base64').toString('utf8')).toBe(MARK_SVG);
    expect(byPath.has('brand/unused.svg')).toBe(false);
    expect([...byPath.keys()].some(p => p.includes('outside'))).toBe(false);
  });

  it('names what it could not collect and why, never dropping it in silence', () => {
    expect(collected.skipped).toEqual([
      { path: 'skills/write-brief/linked.md', reason: 'points outside the workspace folder through a link' },
      { path: 'playbooks/huge/dump.csv', reason: 'is 5,242,881 bytes, over the 5,242,880 a stored file may be' },
    ]);
    expect(collected.files.some(f => f.content.includes('leaked-if-the-guard-is-missing'))).toBe(false);
  });

  it('collects nothing from a folder that is not there', () => {
    expect(collectWorkspaceFiles(join(ROOT, 'nowhere'))).toEqual({ files: [], skipped: [] });
  });
});
