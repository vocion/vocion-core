/**
 * What an apply collects from a workspace folder to store with the project.
 *
 * The rule under test: exactly the files a runtime read would otherwise open
 * off WORKSPACE_PATH, kept at their folder paths and as authored — and nothing
 * a link smuggles in from outside the folder. A SKILL.md folder is collected
 * from the loader's catalog (body plus `sourceFiles`), which is what the mount
 * asks for; a file that is not text is collected base64.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from './loader';
import { collectWorkspaceFiles, encodingFor, MAX_COLLECTED_FILE_BYTES } from './snapshot';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-snapshot-'));
const WS = join(ROOT, 'northwind');
const MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>';
/** A real 1x1 PNG: its header carries NUL bytes, which Postgres refuses in a text column. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** Text in Latin-1, not UTF-8: it would not survive a UTF-8 round trip. */
const LATIN1 = Buffer.from([0x63, 0x61, 0x66, 0xE9]);

function put(rel: string, body: string | Buffer): void {
  mkdirSync(join(WS, rel, '..'), { recursive: true });
  writeFileSync(join(WS, rel), body);
}

put('workspace.yaml', 'version: 1\norgId: proj_northwind\nname: Northwind\n');
put('skills/write-brief/SKILL.md', '---\nslug: write-brief\nname: Write a brief\ndescription: d\n---\n\nCall {{env.NORTHWIND_API_URL}}/briefs.\n');
put('skills/write-brief/REFERENCE.html', '<p>reference</p>');
put('skills/write-brief/.draft.md', 'not authored yet');
put('skills/write-brief/assets/logo.png', PNG);
put('skills/write-brief/latin1.txt', LATIN1);
// A dotted FOLDER: the loader lists what is inside it (only dotted file names
// are skipped), so the mount asks for it and it is stored.
put('skills/write-brief/.assets/mark.svg', MARK_SVG);
put('playbooks/house-style/SKILL.md', '---\nslug: house-style\nname: House style\ndescription: d\n---\n\nPlain.\n');
put('agents/scout.yaml', 'slug: scout\nname: Scout\nsystemPromptFile: scout.system-prompt.md\n');
put('agents/scout.system-prompt.md', 'You scout.');
put('agents/notes.txt', 'scratch');
put('pages/pipeline.yaml', 'slug: pipeline\ntitle: Pipeline\narchetype: markdown\n');
put('pages/pipeline.md', '# Pipeline');
put('pages/components/registry.tsx', 'export const widgets = {};');
put('wiki/voice.md', '---\ntitle: Voice\n---\n\nApplied as an artifact, not read off the folder.\n');
put('brand.yaml', 'name: Northwind\nlogos:\n  mark: brand/mark.svg\n  wordmark: ../outside.svg\n  markOnDark: data:image/png;base64,AAAA\n');
put('brand/mark.svg', MARK_SVG);
put('brand/unused.svg', MARK_SVG);
writeFileSync(join(ROOT, 'outside.svg'), MARK_SVG);
writeFileSync(join(ROOT, 'secret.env'), 'DB_PASSWORD=leaked-if-the-guard-is-missing\n');
symlinkSync(join(ROOT, 'secret.env'), join(WS, 'skills', 'write-brief', 'linked.md'));
put('playbooks/huge/SKILL.md', '---\nslug: huge\nname: Huge\ndescription: d\n---\n\nbody\n');
writeFileSync(join(WS, 'playbooks', 'huge', 'dump.csv'), '');
truncateSync(join(WS, 'playbooks', 'huge', 'dump.csv'), MAX_COLLECTED_FILE_BYTES + 1);

// The loader resolves tokens as it reads a body; the snapshot keeps them raw.
vi.stubEnv('WORKSPACE_TEMPLATE_VARS', 'NORTHWIND_API_URL');
vi.stubEnv('NORTHWIND_API_URL', 'https://api.northwind.example');

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(ROOT, { recursive: true, force: true });
});

describe('collectWorkspaceFiles', () => {
  const loaded = loadWorkspace(WS);
  const collected = collectWorkspaceFiles(WS, [...loaded.skills, ...loaded.playbooks]);
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
      'skills/write-brief/.assets/mark.svg',
      'skills/write-brief/assets/logo.png',
      'skills/write-brief/latin1.txt',
      'skills/write-brief/REFERENCE.html',
      'skills/write-brief/SKILL.md',
      'workspace.yaml',
    ]);
  });

  it('stores every resource the catalog lists for a SKILL.md folder, or names why not', () => {
    const skill = loaded.skills.find(s => s.slug === 'write-brief')!;
    const accounted = new Set([...collected.files.map(f => f.path), ...collected.skipped.map(s => s.path)]);

    for (const rel of ['SKILL.md', ...skill.sourceFiles]) {
      expect(accounted).toContain(`skills/write-brief/${rel}`);
    }
  });

  it('decides text or base64 by the bytes, whatever folder the file sits in', () => {
    const logo = byPath.get('skills/write-brief/assets/logo.png')!;
    const latin1 = byPath.get('skills/write-brief/latin1.txt')!;

    expect(logo.encoding).toBe('base64');
    expect(Buffer.from(logo.content, 'base64').equals(PNG)).toBe(true);
    expect(logo.sha).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(latin1.encoding).toBe('base64');
    expect(byPath.get('skills/write-brief/REFERENCE.html')?.encoding).toBe('utf8');
    expect(encodingFor(Buffer.from('plain ✓ text', 'utf8'))).toBe('utf8');
    expect(encodingFor(Buffer.from('nul\0inside', 'utf8'))).toBe('base64');
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
    expect(collectWorkspaceFiles(join(ROOT, 'nowhere'), loaded.skills)).toEqual({ files: [], skipped: [] });
  });
});
