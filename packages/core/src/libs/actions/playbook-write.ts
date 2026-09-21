/**
 * playbook.write — an agent revises the playbook it works from.
 *
 * A playbook is procedure: how a discovery summary is written, what a
 * proposal has to contain, the order a room is filed in. It is the thing an
 * agent learns MOST about by doing the work, and until now the only way to
 * change one was a person editing `playbooks/<slug>/SKILL.md` in the
 * workspace repo.
 *
 * Two deliberate narrowings, because a playbook is a file the applier
 * validates rather than a row:
 *
 *  - **The body only.** The frontmatter — slug, name, description, attached
 *    playbooks, version — is structure, and a confidence score has no
 *    business rewriting it. An existing playbook keeps its frontmatter
 *    verbatim; a new one gets a minimal manifest built from `name` and
 *    `description`. So a self-update can never produce a workspace that
 *    fails to apply.
 *  - **Only where the workspace is writable.** On a deploy-managed box the
 *    workspace is a read-only checkout, and `precheck` says so — with the
 *    door — before a card exists. An action that queues a card it cannot
 *    execute teaches nobody anything.
 *
 * Reversible: `execute` records the whole previous file, so `undo` is a
 * byte-for-byte restore (or a delete, when the write created the playbook).
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const playbookWriteInput = z.object({
  /** The playbook folder, by slug. Reuse an existing slug to revise it. */
  slug: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a playbook slug is lower-case words joined by single hyphens'),
  /** Human name. Used only when creating; an existing playbook keeps its own. */
  name: z.string().min(1).max(120),
  /** One line saying when to use it. Used only when creating. */
  description: z.string().min(1).max(300),
  /** The whole procedure, markdown, WITHOUT frontmatter. */
  body: z.string().min(1).max(60_000),
  /** Why this revision, in a sentence a person can check. */
  reason: z.string().min(1).max(500),
});

export type PlaybookWriteInput = z.infer<typeof playbookWriteInput>;

/** `---\n<yaml>\n---\n<body>` split, the same shape the workspace loader parses. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split an authored SKILL.md into the frontmatter block (with its fences) and
 * the body beneath it.
 * @param raw - The file as it is on disk.
 */
export function splitPlaybookDoc(raw: string): { frontmatter: string | null; body: string } {
  const m = raw.match(FRONTMATTER);
  if (!m) {
    return { frontmatter: null, body: raw };
  }
  return { frontmatter: `---\n${(m[1] ?? '').trim()}\n---`, body: (m[2] ?? '').trim() };
}

/**
 * The document to write: the playbook's existing frontmatter over the new
 * body, or a minimal manifest when the playbook is new.
 * @param opts - The write.
 * @param opts.existing - The file as it is, or null when creating.
 * @param opts.slug
 * @param opts.name
 * @param opts.description
 * @param opts.body - The new procedure, markdown, no frontmatter.
 */
export function composePlaybookDoc(opts: { existing: string | null; slug: string; name: string; description: string; body: string }): string {
  const keep = opts.existing ? splitPlaybookDoc(opts.existing).frontmatter : null;
  const frontmatter = keep ?? [
    '---',
    `slug: ${opts.slug}`,
    `name: ${JSON.stringify(opts.name)}`,
    `description: ${JSON.stringify(opts.description)}`,
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${opts.body.trim()}\n`;
}

async function locate(ctx: ActionContext, slug: string) {
  const { workspaceDirFor, playbookDocPath } = await import('@/services/selfUpdate/workspaceDoc');
  const dir = await workspaceDirFor(ctx.orgId);
  return { dir, relPath: playbookDocPath(slug) };
}

export const playbookWriteAction: Action<typeof playbookWriteInput> = {
  id: 'playbook.write',
  name: 'Write a playbook',
  description: 'Create or revise a workspace playbook — the procedure an agent follows. Writes the body of `playbooks/<slug>/SKILL.md` and applies the workspace; the manifest is left as authored. Reversible — the previous file is one Undo away.',
  inputSchema: playbookWriteInput,
  grant: 'manage_workspace',
  external: false,
  // A playbook is the procedure the system follows — its own knowledge of
  // how the work is done — so it rides the workspace's learning dial.
  selfImproving: true,
  dedupKeyFor: input => `playbook.write:${input.slug}`,
  async precheck(ctx, input) {
    const { workspaceDocBlocker } = await import('@/services/selfUpdate/workspaceDoc');
    const { dir } = await locate(ctx, input.slug);
    const blocker = workspaceDocBlocker(dir);
    return blocker ? `a playbook cannot be written from here: ${blocker}` : undefined;
  },
  async reviewCard(ctx, input) {
    const { readWorkspaceDoc } = await import('@/services/selfUpdate/workspaceDoc');
    const { diffLines } = await import('./selfUpdate');
    const { dir, relPath } = await locate(ctx, input.slug);
    const existing = dir ? readWorkspaceDoc(dir, relPath) : null;
    const diff = diffLines(existing ? splitPlaybookDoc(existing).body : '', input.body);
    return {
      title: `${existing ? 'Revise' : 'Create'} playbook: ${input.name}`,
      system: 'Workspace',
      summary: input.reason,
      fields: [
        { label: 'Playbook', value: `${input.name} (${input.slug})`, href: `/dashboard/playbooks/${input.slug}` },
        { label: 'File', value: relPath },
        { label: 'Change', value: diff.summary },
        { label: 'Preview', value: input.body.slice(0, 800) + (input.body.length > 800 ? '…' : '') },
      ],
      nextAction: existing
        ? 'Approving rewrites the procedure and applies the workspace; the previous file stays on this run for Undo.'
        : 'Approving creates the playbook folder and applies the workspace.',
      verbs: { approve: existing ? 'Revise' : 'Create', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { readWorkspaceDoc, writeWorkspaceDoc } = await import('@/services/selfUpdate/workspaceDoc');
    const { diffLines } = await import('./selfUpdate');
    const { dir, relPath } = await locate(ctx, input.slug);
    if (!dir) {
      throw new Error('this project has no workspace directory on this host');
    }
    const existing = readWorkspaceDoc(dir, relPath);
    const doc = composePlaybookDoc({ existing, slug: input.slug, name: input.name, description: input.description, body: input.body });
    const res = await writeWorkspaceDoc({
      orgId: ctx.orgId,
      dir,
      relPath,
      content: doc,
      appliedBy: ctx.invokedBy ?? 'playbook.write',
    });
    const diff = diffLines(existing ? splitPlaybookDoc(existing).body : '', input.body);
    return {
      slug: input.slug,
      name: input.name,
      created: existing === null,
      previousDoc: existing,
      workspaceDir: dir,
      relPath,
      change: diff.summary,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      applied: res.applied,
      href: `/dashboard/playbooks/${input.slug}`,
    };
  },
  async undo(ctx, input, result) {
    const { removeWorkspaceDoc, writeWorkspaceDoc } = await import('@/services/selfUpdate/workspaceDoc');
    const dir = typeof result.workspaceDir === 'string' ? result.workspaceDir : (await locate(ctx, input.slug)).dir;
    const relPath = typeof result.relPath === 'string' ? result.relPath : (await locate(ctx, input.slug)).relPath;
    if (!dir) {
      return { undone: false, reason: 'no workspace directory on this host' };
    }
    const appliedBy = `${ctx.invokedBy ?? 'playbook.write'}:undo`;
    if (result.created === true || typeof result.previousDoc !== 'string') {
      // The write created the playbook, so putting it back means removing the
      // folder it created — nothing of anyone else's is in there.
      const res = await removeWorkspaceDoc({ orgId: ctx.orgId, dir, relPath, appliedBy, pruneFolder: true });
      return { undone: true, deleted: relPath, applied: res.applied };
    }
    const res = await writeWorkspaceDoc({ orgId: ctx.orgId, dir, relPath, content: result.previousDoc, appliedBy });
    return { undone: true, restoredBytes: res.bytes, applied: res.applied };
  },
};
