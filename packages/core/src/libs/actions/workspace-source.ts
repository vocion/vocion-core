/**
 * workspace.write_mission / workspace.write_playbook — an agent edits a
 * mission's YAML or a playbook's SKILL.md.
 *
 * The write itself is `services/workspace/WorkspaceSourceService.ts`: the
 * file first, then the mirror artifact's new version, then an apply. Going
 * through the action framework is what makes an AGENT'S edit reviewable and
 * reversible: the card carries the diff and the reason, a person approves or
 * leaves it, and Undo puts the previous text back as a new version. A
 * person's own edit in the pane is not an action — it is their workspace.
 *
 * Both kinds start at Execute with approval. They are reversible and internal,
 * which under the done-for-you default would run them above 0.8 — but a
 * mission is a standing responsibility and a playbook is procedure every run
 * reads, so `DEFAULT_RISK_TIER` (`services/autonomy/rungs.ts`) marks them
 * `medium`, and a workspace promotes them in `trust.yaml` once approvals have
 * earned it, exactly as the ladder intends.
 */

import type { Action, ActionContext } from './types';
import type { SourceKind } from '@/libs/workspace/source';
import { z } from 'zod';
import { diffCounts, unifiedLineDiff } from '@/libs/workspace/lineDiff';
import { sourceRelPath, SourceValidationError, validateSourceText } from '@/libs/workspace/source';

const base = {
  /** The whole file as it should read afterwards — never a fragment. */
  content: z.string().min(1).max(200_000),
  /** Why — the version history and the card read this back. */
  reason: z.string().min(1).max(500),
};

const writeMissionInput = z.object({
  slug: z.string().min(1).max(120),
  ...base,
});

const writePlaybookInput = z.object({
  slug: z.string().min(1).max(120),
  /** Which SKILL.md folder. Skills share the page and the shape. */
  kind: z.enum(['playbook', 'skill']).default('playbook'),
  ...base,
});

export type WriteMissionInput = z.infer<typeof writeMissionInput>;
export type WritePlaybookInput = z.infer<typeof writePlaybookInput>;

type AnyInput = { slug: string; kind?: 'playbook' | 'skill'; content: string; reason: string };

function kindOf(actionKind: 'mission' | 'playbook', input: AnyInput): SourceKind {
  return actionKind === 'mission' ? 'mission' : (input.kind ?? 'playbook');
}

function noun(kind: SourceKind): string {
  return kind === 'mission' ? 'mission' : kind === 'skill' ? 'skill' : 'playbook';
}

async function precheck(actionKind: 'mission' | 'playbook', ctx: ActionContext, input: AnyInput): Promise<string | void> {
  const kind = kindOf(actionKind, input);
  try {
    validateSourceText(kind, input.slug, input.content);
  } catch (err) {
    if (err instanceof SourceValidationError) {
      return `the ${noun(kind)} file does not validate: ${err.message}`;
    }
    throw err;
  }
  // Refuse before a card exists when the write cannot happen here — a
  // deploy-managed box mounts the workspace read-only, and a "Failed" card
  // teaches nobody anything.
  const { workspaceDirFor } = await import('@/services/workspace/WorkspaceSourceService');
  const dir = await workspaceDirFor(ctx.orgId);
  if (!dir) {
    return `this project has no workspace directory on this host, so ${noun(kind)}s are edited in the workspace repo and applied from there`;
  }
  // `workspaceWriteBlocker` takes the path as configured; `workspaceDirFor` is absolute, which it accepts too.
  const { workspaceWriteBlocker } = await import('@/services/PluginService');
  const blocker = workspaceWriteBlocker(dir);
  return blocker ? `the ${noun(kind)} cannot be written from here: ${blocker}` : undefined;
}

async function reviewCard(actionKind: 'mission' | 'playbook', ctx: ActionContext, input: AnyInput) {
  const kind = kindOf(actionKind, input);
  const { getSourceArtifact, resolveSourceFile, workspaceDirFor } = await import('@/services/workspace/WorkspaceSourceService');
  const dir = await workspaceDirFor(ctx.orgId);
  const current = dir ? resolveSourceFile(dir, kind, input.slug) : null;
  const mirror = await getSourceArtifact(ctx.orgId, kind, input.slug);
  const before = current?.content ?? '';
  const counts = diffCounts(before, input.content);
  const diff = unifiedLineDiff(before, input.content, { context: 2, maxChars: 3000 });
  let title = input.slug;
  try {
    title = validateSourceText(kind, input.slug, input.content).title;
  } catch {
    /* precheck already refused an invalid file; the card falls back to the slug */
  }
  const verb = current ? 'Revise' : 'Create';
  const href = mirror ? `/dashboard/artifacts/${mirror.id}` : kind === 'mission' ? `/dashboard/missions/${input.slug}` : `/dashboard/skills/${input.slug}`;
  return {
    title: `${verb} ${noun(kind)}: ${title}`,
    system: 'Workspace',
    summary: input.reason,
    fields: [
      { label: noun(kind).charAt(0).toUpperCase() + noun(kind).slice(1), value: `${title} (${input.slug})`, href },
      { label: 'File', value: sourceRelPath(kind, input.slug) + (current?.layer === 'core' ? ' — a workspace copy of the inherited default' : '') },
      { label: 'Change', value: current ? `−${counts.removed} / +${counts.added} lines${mirror ? `, replaces v${mirror.currentVersion}` : ''}` : `${input.content.length.toLocaleString()} characters, new file` },
      { label: 'Diff', value: diff || (current ? 'No change to the text.' : input.content.slice(0, 1500)) },
    ],
    nextAction: current
      ? `Approving writes the file, records v${(mirror?.currentVersion ?? 0) + 1} on its history, and applies the workspace. The previous text stays one Undo away.`
      : `Approving creates ${sourceRelPath(kind, input.slug)} and applies the workspace. Undo removes it.`,
    verbs: { approve: verb, reject: 'Leave as is' },
  };
}

async function execute(actionKind: 'mission' | 'playbook', ctx: ActionContext, input: AnyInput): Promise<Record<string, unknown>> {
  const kind = kindOf(actionKind, input);
  const { writeWorkspaceSource } = await import('@/services/workspace/WorkspaceSourceService');
  const author = ctx.invokedBy?.startsWith('agent:')
    ? { kind: 'agent' as const, id: ctx.invokedBy }
    : { kind: ctx.reviewedBy ? 'human' as const : 'system' as const, id: ctx.reviewedBy ?? ctx.invokedBy ?? null };
  const res = await writeWorkspaceSource({
    orgId: ctx.orgId,
    kind,
    slug: input.slug,
    content: input.content,
    author,
    changeSummary: input.reason,
    noCollapse: true,
    appliedBy: ctx.reviewedBy ?? ctx.invokedBy ?? 'agent',
    runId: ctx.runId !== undefined ? String(ctx.runId) : null,
  });
  return {
    artifactId: res.artifact.id,
    kind,
    slug: input.slug,
    version: res.version.version,
    previousVersion: res.previousVersion,
    created: res.created,
    unchanged: res.unchanged,
    path: sourceRelPath(kind, input.slug),
    href: `/dashboard/artifacts/${res.artifact.id}`,
    workspaceVersionId: res.applied?.versionId ?? null,
    sha: res.applied?.sha ?? null,
  };
}

async function undo(ctx: ActionContext, _input: AnyInput, result: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = result.kind as SourceKind | undefined;
  const slug = typeof result.slug === 'string' ? result.slug : null;
  const id = Number(result.artifactId);
  if (!kind || !slug || !Number.isInteger(id) || id <= 0) {
    return { undone: false, reason: 'no source on the run' };
  }
  const { removeWorkspaceSource, restoreWorkspaceSource } = await import('@/services/workspace/WorkspaceSourceService');
  if (result.created) {
    const removed = await removeWorkspaceSource({ orgId: ctx.orgId, kind, slug, appliedBy: ctx.reviewedBy ?? 'undo' });
    return { undone: true, removed: removed.removed, rows: removed.rows };
  }
  const prev = Number(result.previousVersion);
  if (!Number.isInteger(prev) || prev <= 0) {
    return { undone: false, reason: 'no previous version to restore' };
  }
  const restored = await restoreWorkspaceSource({ orgId: ctx.orgId, id, version: prev, author: { kind: 'human', id: ctx.reviewedBy ?? null } });
  return { undone: true, restoredVersion: prev, asVersion: restored.version.version };
}

export const workspaceWriteMissionAction: Action<typeof writeMissionInput> = {
  id: 'workspace.write_mission',
  name: 'Write a mission',
  description: 'Create or revise a mission\'s YAML in the workspace (goal, success criteria, owner, autonomy) and apply it. Reversible — the previous text is one Undo away.',
  inputSchema: writeMissionInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `workspace.write_mission:${input.slug.toLowerCase()}`,
  precheck: (ctx, input) => precheck('mission', ctx, input),
  reviewCard: (ctx, input) => reviewCard('mission', ctx, input),
  execute: (ctx, input) => execute('mission', ctx, input),
  undo,
};

export const workspaceWritePlaybookAction: Action<typeof writePlaybookInput> = {
  id: 'workspace.write_playbook',
  name: 'Write a playbook',
  description: 'Create or revise a playbook\'s (or a skill\'s) SKILL.md in the workspace and apply it. Reversible — the previous text is one Undo away.',
  inputSchema: writePlaybookInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `workspace.write_playbook:${(input.kind ?? 'playbook')}:${input.slug.toLowerCase()}`,
  precheck: (ctx, input) => precheck('playbook', ctx, input),
  reviewCard: (ctx, input) => reviewCard('playbook', ctx, input),
  execute: (ctx, input) => execute('playbook', ctx, input),
  undo,
};
