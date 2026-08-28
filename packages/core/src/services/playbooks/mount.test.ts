/**
 * Skill/playbook mounting — the failure this covers is invisible by design.
 *
 * When a SKILL.md cannot be located, `mountSkills` skips the folder without
 * erroring, so the agent simply never sees the file and writes from nothing.
 * That is what happened with an ABSOLUTE `WORKSPACE_PATH`: prod sets
 * `/workspace/metacto-revenue` against an `/app` workdir, and joining it onto
 * cwd produced `/app/workspace/...`, which does not exist.
 *
 * Mounting is BY NAME: an agent's skills list, its playbooks list, and each
 * mounted skill's attached playbooks. Nothing mounts by tag.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { playbookSchema } = await import('@/models/Schema');
const { mountSkills } = await import('./mount');

const ORG = 'org_playbooks';

/** A workspace on disk with one skill + one playbook in it. */
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-ws-'));
const WORKSPACE = join(ROOT, 'workspace', 'acme');
const SKILL_BODY = '# Write a lead brief\n\nResearch one lead.\n';
const PLAYBOOK_BODY = '# House style\n\nWrite plainly.\n';

mkdirSync(join(WORKSPACE, 'skills', 'write-lead-brief'), { recursive: true });
writeFileSync(join(WORKSPACE, 'skills', 'write-lead-brief', 'SKILL.md'), SKILL_BODY);
writeFileSync(join(WORKSPACE, 'skills', 'write-lead-brief', 'examples.md'), 'an example');
mkdirSync(join(WORKSPACE, 'playbooks', 'house-style'), { recursive: true });
writeFileSync(join(WORKSPACE, 'playbooks', 'house-style', 'SKILL.md'), PLAYBOOK_BODY);

const ORIGINAL_PATH = process.env.WORKSPACE_PATH;

beforeEach(async () => {
  await db.delete(playbookSchema);
  await db.insert(playbookSchema).values([
    {
      orgId: ORG,
      slug: 'write-lead-brief',
      name: 'Write a lead brief',
      description: 'Research one lead and produce one concise decision brief.',
      kind: 'skill',
      origin: 'workspace',
      attachedPlaybooks: ['house-style'],
      contentSha: 'sha-write-lead-brief',
      sourceFiles: ['examples.md'],
    },
    {
      orgId: ORG,
      slug: 'house-style',
      name: 'House style',
      description: 'How we write.',
      kind: 'playbook',
      origin: 'workspace',
      contentSha: 'sha-house-style',
      sourceFiles: [],
    },
  ]);
});

afterAll(async () => {
  await db.delete(playbookSchema);
  if (ORIGINAL_PATH === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = ORIGINAL_PATH;
  }
  rmSync(ROOT, { recursive: true, force: true });
});

describe('mountSkills', () => {
  it('mounts a named skill (with siblings) when WORKSPACE_PATH is absolute, which is what prod sets', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files['/skills/write-lead-brief/SKILL.md']).toBe(SKILL_BODY);
    expect(files['/skills/write-lead-brief/examples.md']).toBe('an example');
  });

  it('a mounted skill pulls its attached playbooks along', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(files['/playbooks/house-style/SKILL.md']).toBe(PLAYBOOK_BODY);
  });

  it('an agent naming nothing mounts nothing, whatever the org has', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });

  it('a playbook named by the agent mounts without any skill', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(Object.keys(files)).toEqual(['/playbooks/house-style/SKILL.md']);
  });

  it('skips silently when the file is missing on disk', async () => {
    process.env.WORKSPACE_PATH = join(ROOT, 'nowhere');

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['write-lead-brief'], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });

  it('never mounts a slug the caller did not name as the right kind', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    // Asking for the playbook as a SKILL mounts nothing: names are typed.
    const files = await mountSkills({ orgId: ORG, skillSlugs: ['house-style'], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });
});
