/**
 * Warn when a workspace apply empties one of an agent's authored lists
 * (VEERIO-252 item 3). An apply from a branch that is simply missing the
 * agent's playbook/skill/object-type/learning-step files — rather than one
 * that deliberately cleared the list — used to silently write
 * `playbookSlugs: [] ` (etc.) over a non-empty list with nothing but
 * `updated=1` to show for it. These tests pin that a warning naming the
 * agent and the emptied list(s) is produced, both in the returned
 * `ApplyResult.warnings` and on stderr via `console.warn`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_emptied_agent_lists';
const SLUG = 'probe-agent';

const dirs: string[] = [];

/**
 * A one-agent workspace. All four `AGENT_LIST_FIELDS` are exercised here:
 * `playbooks` and `skills` each need a real SKILL.md folder to resolve
 * (proving the wiring reaches a real authored resource, not just a made-up
 * string — `assertNamedRefs` in loader.ts throws on an agent naming a skill
 * or playbook that resolves to nothing), `objectTypes` and `learningSteps`
 * need no such folder (loader.ts runs no cross-reference validation for
 * either — `assertNamedRefs` only checks `skills` and `playbooks`), so a
 * made-up name is enough to populate them.
 * @param opts
 * @param opts.playbooks - Playbook slugs the agent names, or `[]`/omitted for none.
 * @param opts.skills - Skill slugs the agent names, or `[]`/omitted for none.
 * @param opts.objectTypes - Object type slugs the agent names, or `[]`/omitted for none.
 * @param opts.learningSteps - Learning step names the agent names, or `[]`/omitted for none.
 * @param opts.includePlaybookFolder - Whether to write the `playbooks/house-style/SKILL.md` file `playbooks: [house-style]` needs to resolve.
 * @param opts.includeSkillFolder - Whether to write the `skills/call-notes/SKILL.md` file `skills: [call-notes]` needs to resolve.
 */
function writeFixture(opts: {
  playbooks?: string[];
  skills?: string[];
  objectTypes?: string[];
  learningSteps?: string[];
  includePlaybookFolder?: boolean;
  includeSkillFolder?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-emptied-lists-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: emptied-lists\n`);
  mkdirSync(join(dir, 'agents'));
  const playbooksLine = opts.playbooks?.length ? `playbooks: [${opts.playbooks.join(', ')}]\n` : '';
  const skillsLine = opts.skills?.length ? `skills: [${opts.skills.join(', ')}]\n` : '';
  const objectTypesLine = opts.objectTypes?.length ? `objectTypes: [${opts.objectTypes.join(', ')}]\n` : '';
  const learningStepsLine = opts.learningSteps?.length ? `learningSteps: [${opts.learningSteps.join(', ')}]\n` : '';
  writeFileSync(
    join(dir, 'agents', `${SLUG}.yaml`),
    `slug: ${SLUG}\nname: Probe Agent\nsystemPrompt: Be helpful.\n${playbooksLine}${skillsLine}${objectTypesLine}${learningStepsLine}`,
  );
  if (opts.includePlaybookFolder) {
    mkdirSync(join(dir, 'playbooks', 'house-style'), { recursive: true });
    writeFileSync(
      join(dir, 'playbooks', 'house-style', 'SKILL.md'),
      '---\nslug: house-style\nname: House Style\ndescription: test fixture playbook\n---\n\nBody.\n',
    );
  }
  if (opts.includeSkillFolder) {
    mkdirSync(join(dir, 'skills', 'call-notes'), { recursive: true });
    writeFileSync(
      join(dir, 'skills', 'call-notes', 'SKILL.md'),
      '---\nslug: call-notes\nname: Call Notes\ndescription: test fixture skill\n---\n\nBody.\n',
    );
  }
  return dir;
}

async function apply(opts: {
  playbooks?: string[];
  skills?: string[];
  objectTypes?: string[];
  learningSteps?: string[];
  includePlaybookFolder?: boolean;
  includeSkillFolder?: boolean;
}) {
  const loaded = await loadWorkspace(writeFixture(opts));
  return applyWorkspace(loaded, { orgId: ORG });
}

async function storedAgent() {
  const [row] = await db
    .select({
      playbookSlugs: agentSchema.playbookSlugs,
      skillSlugs: agentSchema.skillSlugs,
      objectTypeSlugs: agentSchema.objectTypeSlugs,
      learningSteps: agentSchema.learningSteps,
    })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, ORG), eq(agentSchema.slug, SLUG)));
  return row;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('workspace apply — emptied agent lists', () => {
  it('warns, naming the agent and the list, when an apply drops all of an agent\'s playbooks', async () => {
    await apply({ playbooks: ['house-style'], includePlaybookFolder: true });

    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      resource: 'agent',
      slug: SLUG,
      message: expect.stringContaining('playbookSlugs'),
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(SLUG));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('playbookSlugs'));
    expect((await storedAgent())?.playbookSlugs).toEqual([]);
  });

  it('warns, naming the agent and the list, when an apply drops all of an agent\'s skills', async () => {
    await apply({ skills: ['call-notes'], includeSkillFolder: true });

    const result = await apply({ skills: [] });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      resource: 'agent',
      slug: SLUG,
      message: expect.stringContaining('skillSlugs'),
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(SLUG));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skillSlugs'));
    expect((await storedAgent())?.skillSlugs).toEqual([]);
  });

  it('warns, naming the agent and the list, when an apply drops all of an agent\'s object types', async () => {
    await apply({ objectTypes: ['deal'] });

    const result = await apply({ objectTypes: [] });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      resource: 'agent',
      slug: SLUG,
      message: expect.stringContaining('objectTypeSlugs'),
    }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(SLUG));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('objectTypeSlugs'));
    expect((await storedAgent())?.objectTypeSlugs).toEqual([]);
  });

  it('names every list that emptied, not just one, when all four drop at once', async () => {
    await apply({
      playbooks: ['house-style'],
      skills: ['call-notes'],
      objectTypes: ['deal'],
      learningSteps: ['alpha', 'beta'],
      includePlaybookFolder: true,
      includeSkillFolder: true,
    });

    const result = await apply({ playbooks: [], skills: [], objectTypes: [], learningSteps: [] });

    const warning = result.warnings.find(w => w.slug === SLUG);

    expect(warning?.message).toContain('playbookSlugs');
    expect(warning?.message).toContain('skillSlugs');
    expect(warning?.message).toContain('objectTypeSlugs');
    expect(warning?.message).toContain('learningSteps');
  });

  it('does not warn when only one list empties and the other stays untouched', async () => {
    await apply({ playbooks: ['house-style'], learningSteps: ['alpha'], includePlaybookFolder: true });

    const result = await apply({ playbooks: [], learningSteps: ['alpha'] });

    const warning = result.warnings.find(w => w.slug === SLUG);

    expect(warning?.message).toContain('playbookSlugs');
    expect(warning?.message).not.toContain('learningSteps');
  });

  it('does not warn on the first apply, when the list was never non-empty', async () => {
    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.warnings).toHaveLength(0);
    // console.warn may still fire for unrelated reasons (e.g. the schedule
    // reconciliation ownership guard on a dev box) — assert specifically
    // that no "emptied" warning was produced, not that warn was never called.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('emptied'));
  });

  it('does not warn when a re-apply changes nothing (unchanged, not updated)', async () => {
    await apply({ playbooks: [], learningSteps: [] });

    const result = await apply({ playbooks: [], learningSteps: [] });

    expect(result.counts.agents).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(result.warnings).toHaveLength(0);
  });

  it('does not warn when a list goes from empty to non-empty', async () => {
    await apply({ playbooks: [], learningSteps: [] });

    const result = await apply({ playbooks: ['house-style'], learningSteps: [], includePlaybookFolder: true });

    expect(result.counts.agents).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(result.warnings).toHaveLength(0);
  });
});
