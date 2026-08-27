/**
 * Playbook mounting — the failure this covers is invisible by design.
 *
 * When the SKILL.md cannot be located, `mountPlaybooks` skips the playbook
 * without erroring, so the agent simply never sees the file and writes from
 * nothing. That is what happened with an ABSOLUTE `WORKSPACE_PATH`: prod sets
 * `/workspace/metacto-revenue` against an `/app` workdir, and joining it onto
 * cwd produced `/app/workspace/...`, which does not exist.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { playbookSchema } = await import('@/models/Schema');
const { isPlaybookMounted, mountPlaybooks } = await import('./mount');

const ORG = 'org_playbooks';

/** A workspace on disk with one playbook in it. */
const ROOT = mkdtempSync(join(tmpdir(), 'vocion-ws-'));
const WORKSPACE = join(ROOT, 'workspace', 'acme');
const BODY = '# Write a lead brief\n\nResearch one lead.\n';

mkdirSync(join(WORKSPACE, 'playbooks', 'write-lead-brief'), { recursive: true });
writeFileSync(join(WORKSPACE, 'playbooks', 'write-lead-brief', 'SKILL.md'), BODY);
writeFileSync(join(WORKSPACE, 'playbooks', 'write-lead-brief', 'examples.md'), 'an example');

const ORIGINAL_PATH = process.env.WORKSPACE_PATH;

beforeEach(async () => {
  await db.delete(playbookSchema);
  await db.insert(playbookSchema).values({
    orgId: ORG,
    slug: 'write-lead-brief',
    name: 'Write a lead brief',
    description: 'Research one lead and produce one concise decision brief.',
    contentSha: 'sha-write-lead-brief',
    tags: ['personalization'],
    sourceFiles: ['examples.md'],
  });
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

describe('mountPlaybooks', () => {
  it('mounts the body when WORKSPACE_PATH is absolute, which is what prod sets', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountPlaybooks({ orgId: ORG, agentTags: ['personalization'] });

    expect(files['/playbooks/write-lead-brief/SKILL.md']).toBe(BODY);
    expect(files['/playbooks/write-lead-brief/examples.md']).toBe('an example');
  });

  it('mounts the body when WORKSPACE_PATH is relative, which is what dev sets', async () => {
    process.env.WORKSPACE_PATH = relative(process.cwd(), WORKSPACE);

    const files = await mountPlaybooks({ orgId: ORG, agentTags: ['personalization'] });

    expect(files['/playbooks/write-lead-brief/SKILL.md']).toBe(BODY);
  });

  it('mounts nothing for an agent whose tags do not intersect', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountPlaybooks({ orgId: ORG, agentTags: ['revenue-brief'] });

    // The silent half of the trap: no error, the agent just never sees it.
    expect(files).toStrictEqual({});
    expect(isPlaybookMounted(['personalization'], ['revenue-brief'])).toBe(false);
    expect(isPlaybookMounted(['personalization'], ['revenue-brief', 'personalization'])).toBe(true);
  });

  it('never mounts another org playbook', async () => {
    process.env.WORKSPACE_PATH = WORKSPACE;

    const files = await mountPlaybooks({ orgId: 'org_other', agentTags: null });

    expect(files).toStrictEqual({});
  });
});
