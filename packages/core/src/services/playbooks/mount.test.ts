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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** A second workspace whose playbook names a per-deployment API URL. */
const TEMPLATED_WORKSPACE = join(ROOT, 'workspace', 'templated');
mkdirSync(join(TEMPLATED_WORKSPACE, 'playbooks', 'house-style'), { recursive: true });
writeFileSync(
  join(TEMPLATED_WORKSPACE, 'playbooks', 'house-style', 'SKILL.md'),
  '# House style\n\nFetch {{env.VEERIO_API_URL}}/api/sources.\n',
);
mkdirSync(join(TEMPLATED_WORKSPACE, 'skills', 'pipeline-health'), { recursive: true });
writeFileSync(
  join(TEMPLATED_WORKSPACE, 'skills', 'pipeline-health', 'SKILL.md'),
  '# Pipeline health\n\nCall {{env.VEERIO_API_URL}}/api/pipeline.\n',
);

const ORIGINAL_PATH = process.env.WORKSPACE_PATH;
const ORIGINAL_ALLOWLIST = process.env.WORKSPACE_TEMPLATE_VARS;
const ORIGINAL_API_URL = process.env.VEERIO_API_URL;

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
    {
      orgId: ORG,
      slug: 'pipeline-health',
      name: 'Pipeline health',
      description: 'A base-pack skill the workspace also carries a copy of.',
      kind: 'skill',
      origin: 'override',
      contentSha: 'sha-pipeline-health',
      sourceFiles: [],
    },
  ]);
});

/**
 * Put one env var back the way the test process found it.
 * @param name - the variable to restore.
 * @param original - its value before the test touched it, or undefined.
 */
function restoreEnvVar(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

afterEach(() => {
  restoreEnvVar('WORKSPACE_PATH', ORIGINAL_PATH);
  restoreEnvVar('WORKSPACE_TEMPLATE_VARS', ORIGINAL_ALLOWLIST);
  restoreEnvVar('VEERIO_API_URL', ORIGINAL_API_URL);
});

afterAll(async () => {
  await db.delete(playbookSchema);
  restoreEnvVar('WORKSPACE_PATH', ORIGINAL_PATH);
  restoreEnvVar('WORKSPACE_TEMPLATE_VARS', ORIGINAL_ALLOWLIST);
  restoreEnvVar('VEERIO_API_URL', ORIGINAL_API_URL);
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

  it('resolves an {{env.NAME}} token before the agent ever sees the body', async () => {
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    process.env.VEERIO_API_URL = 'https://api-dev.veerio.app';

    const files = await mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] });

    expect(files['/playbooks/house-style/SKILL.md']).toContain('https://api-dev.veerio.app/api/sources');
    expect(files['/playbooks/house-style/SKILL.md']).not.toContain('{{');
  });

  it('refuses to mount rather than serve a raw token when the variable is missing', async () => {
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    delete process.env.VEERIO_API_URL;

    await expect(
      mountSkills({ orgId: ORG, skillSlugs: [], playbookSlugs: ['house-style'] }),
    ).rejects.toThrow(/VEERIO_API_URL/);
  });

  it('an override row whose workspace copy has an unresolvable token fails instead of quietly serving the base copy', async () => {
    // The base pack has a pipeline-health skill, so a silent fallback
    // here would hand the agent the WRONG body and look like success.
    process.env.WORKSPACE_PATH = TEMPLATED_WORKSPACE;
    process.env.WORKSPACE_TEMPLATE_VARS = 'VEERIO_API_URL';
    delete process.env.VEERIO_API_URL;

    await expect(
      mountSkills({ orgId: ORG, skillSlugs: ['pipeline-health'], playbookSlugs: [] }),
    ).rejects.toThrow(/VEERIO_API_URL/);
  });

  it('falls back to the base copy when the workspace file is simply absent', async () => {
    process.env.WORKSPACE_PATH = join(ROOT, 'nowhere');

    const files = await mountSkills({ orgId: ORG, skillSlugs: ['pipeline-health'], playbookSlugs: [] });

    expect(files['/skills/pipeline-health/SKILL.md']).toContain('pipeline');
  });

  it('never mounts a slug the caller did not name as the right kind', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    // Asking for the playbook as a SKILL mounts nothing: names are typed.
    const files = await mountSkills({ orgId: ORG, skillSlugs: ['house-style'], playbookSlugs: [] });

    expect(Object.keys(files)).toHaveLength(0);
  });
});
