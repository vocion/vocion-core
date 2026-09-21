/**
 * read_mission / write_mission / read_playbook / write_playbook — a mission's
 * YAML and a playbook's SKILL.md as the agent works them.
 *
 * "Tighten the goal", "add a success criterion about response time", "make
 * step three say to check the wiki first" are edits to the FILE the mission
 * or playbook is, so the tools read and write the whole file: the agent reads
 * it, changes what was asked, and hands the whole text back. Writing goes
 * through the `workspace.write_mission` / `workspace.write_playbook` actions
 * (`libs/actions/workspace-source.ts`), which is what makes an agent's edit
 * reviewable — a card with the diff and the reason — and reversible. Both
 * kinds start at Execute with approval, so the receipt says PENDING until a
 * person decides, and the agent must not claim the file changed.
 *
 * Which mission or playbook is "this"? The page context carries the record
 * (`{ type: 'mission' | 'playbook', id: slug }`) or the mirror artifact the
 * person has open, so an unqualified "change this" resolves without a slug.
 */

import type { RuntimeContext } from '../types';
import type { SourceKind } from '@/libs/workspace/source';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { sourceKindOf, sourceRelPath } from '@/libs/workspace/source';
import { ActionError, proposeAction } from '@/services/ActionService';
import { getArtifact } from '@/services/ArtifactService';

type Family = 'mission' | 'playbook';

/**
 * The slug the page context points at for a family, if any: the page's
 * record, an @-mentioned one, or the mirror artifact that is open.
 * @param ctx
 * @param family
 */
export async function contextualSourceSlug(ctx: RuntimeContext, family: Family): Promise<{ slug: string; kind: SourceKind } | null> {
  const refs = [ctx.pageContext?.record, ...(ctx.pageContext?.refs ?? [])];
  for (const ref of refs) {
    if (ref?.type === family && ref.id) {
      return { slug: ref.id, kind: family };
    }
  }
  for (const ref of refs) {
    if (ref?.type === 'artifact') {
      const id = Number(ref.id);
      if (!Number.isInteger(id) || id <= 0) {
        continue;
      }
      const row = await getArtifact({ orgId: ctx.orgId, id });
      const kind = row ? sourceKindOf(row.kind, row.spec) : null;
      if (row && kind && (kind === 'mission' ? family === 'mission' : family === 'playbook')) {
        const slug = typeof row.spec.slug === 'string' ? row.spec.slug : row.recordId;
        if (slug) {
          return { slug, kind };
        }
      }
    }
  }
  return null;
}

function principalFor(ctx: RuntimeContext) {
  return {
    kind: 'agent' as const,
    id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
    scope: { orgId: ctx.orgId },
    grants: ['*'],
    autonomy: 2 as const,
  };
}

async function readSource(ctx: RuntimeContext, family: Family, slugArg: string | undefined, kindArg?: 'playbook' | 'skill') {
  const { resolveSourceFile, workspaceDirFor } = await import('@/services/workspace/WorkspaceSourceService');
  const target = slugArg ? { slug: slugArg, kind: (family === 'mission' ? 'mission' : (kindArg ?? 'playbook')) as SourceKind } : await contextualSourceSlug(ctx, family);
  if (!target) {
    return `No ${family} is named and none is on the page. Pass a slug (the ${family} list, or the record the person is looking at).`;
  }
  const dir = await workspaceDirFor(ctx.orgId);
  if (!dir) {
    return `This project has no workspace directory on this host, so ${family} files cannot be read here.`;
  }
  let file = resolveSourceFile(dir, target.kind, target.slug);
  // A playbook page shows skills too; try the other folder before giving up.
  if (!file && family === 'playbook' && !kindArg) {
    const other: SourceKind = target.kind === 'skill' ? 'playbook' : 'skill';
    const alt = resolveSourceFile(dir, other, target.slug);
    if (alt) {
      file = alt;
      target.kind = other;
    }
  }
  if (!file) {
    return `No ${family} "${target.slug}" — nothing at ${sourceRelPath(target.kind, target.slug)} in the workspace, a plugin or the base pack.`;
  }
  const where = file.layer === 'workspace' ? 'the workspace' : 'an inherited layer (a plugin or the base pack) — writing it creates the workspace\'s own copy';
  return `# ${target.kind} ${target.slug}\n(file ${sourceRelPath(target.kind, target.slug)} · from ${where})\n\n${file.content}`;
}

async function writeSource(ctx: RuntimeContext, family: Family, input: { slug?: string; kind?: 'playbook' | 'skill'; content: string; reason: string; confidence: number }) {
  const target = input.slug
    ? { slug: input.slug, kind: (family === 'mission' ? 'mission' : (input.kind ?? 'playbook')) as SourceKind }
    : await contextualSourceSlug(ctx, family);
  if (!target) {
    return `No ${family} is named and none is on the page — pass a slug.`;
  }
  const actionId = family === 'mission' ? 'workspace.write_mission' : 'workspace.write_playbook';
  const toolName = `write_${family}`;
  try {
    const res = await proposeAction({
      orgId: ctx.orgId,
      actionId,
      input: family === 'mission'
        ? { slug: target.slug, content: input.content, reason: input.reason }
        : { slug: target.slug, kind: target.kind === 'skill' ? 'skill' : 'playbook', content: input.content, reason: input.reason },
      principal: principalFor(ctx),
      invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
      proposal: {
        confidence: input.confidence,
        rationale: input.reason,
        suggestedDecision: 'approve',
        suggestedDecisionReason: input.reason.slice(0, 160),
      },
    });
    ctx.emit({ type: 'tool_progress', tool: toolName, meta: { runId: res.runId, status: res.status, outcome: res.outcome } } as never);
    if (res.outcome === 'already_decided') {
      return `Not written: a person already decided an identical change to ${family} "${target.slug}" (run #${res.runId}, ${res.status}). Say so; do not propose it again.`;
    }
    if (res.status === 'pending') {
      return `The change to ${family} "${target.slug}" is PENDING a person's decision (run #${res.runId}) — it is in Review with the diff. Do NOT say the ${family} was changed; say it is queued for their approval and what it will change.`;
    }
    const r = (res.result ?? {}) as { href?: string; version?: number; created?: boolean; unchanged?: boolean; path?: string };
    if (r.unchanged) {
      return `${family} "${target.slug}" already read exactly like that — no new version (run #${res.runId}).`;
    }
    return `${family} "${target.slug}" ${r.created ? 'created' : `revised to v${r.version}`} — ${r.path ?? ''} written and the workspace applied (run #${res.runId}, confidence ${input.confidence}). ${r.href ?? ''} The person sees it live; a person can undo it from Review › Decided. Git commit is theirs.`;
  } catch (err) {
    if (err instanceof ActionError) {
      return `${toolName} refused (${err.code}): ${err.message}`;
    }
    return `${toolName} failed: ${(err as Error).message}`;
  }
}

const writeShape = {
  content: z.string().min(1).max(200_000).describe('The WHOLE file as it should read afterwards — read it first, change what was asked, keep everything else byte for byte.'),
  reason: z.string().min(1).max(500).describe('Why this change, in one or two sentences a person can check — it becomes the version\'s change summary and the card\'s summary.'),
  confidence: z.number().min(0).max(1).describe('Your confidence this is the right change, 0–1. Honest: it decides whether the change waits for a person (the default for missions and playbooks) or, once a workspace has promoted the kind, runs on its own.'),
};

export function readMissionTool(ctx: RuntimeContext) {
  return tool(
    async ({ slug }) => readSource(ctx, 'mission', slug),
    {
      name: 'read_mission',
      description: 'Read a mission\'s YAML file in full — slug, name, goal, success criteria, owner agent, autonomy. Omit `slug` for the mission the person is looking at. Call this before write_mission so the edit changes what is really there.',
      schema: z.object({ slug: z.string().min(1).optional().describe('The mission slug. Omit for the mission on the page.') }),
    },
  );
}

export function writeMissionTool(ctx: RuntimeContext) {
  return tool(
    async input => writeSource(ctx, 'mission', input as { slug?: string; content: string; reason: string; confidence: number }),
    {
      name: 'write_mission',
      description: 'Change a mission — its goal, success criteria, deliverables, owner or autonomy — by writing its WHOLE YAML file back. This is how you answer "make the goal about Q4", "add a success criterion" or "Change this: …" on a mission page: read_mission, edit the text, write_mission. Goes through review: a person approves the diff (the default), then the file is written, versioned and applied. Never invent fields — the file must validate as a mission.',
      schema: z.object({ slug: z.string().min(1).optional().describe('The mission slug. Omit for the mission on the page.'), ...writeShape }),
    },
  );
}

export function readPlaybookTool(ctx: RuntimeContext) {
  return tool(
    async ({ slug, kind }) => readSource(ctx, 'playbook', slug, kind),
    {
      name: 'read_playbook',
      description: 'Read a playbook\'s or a skill\'s SKILL.md in full — the YAML frontmatter (slug, name, description, playbooks) and the markdown body. Omit `slug` for the one the person is looking at. Call this before write_playbook.',
      schema: z.object({
        slug: z.string().min(1).optional().describe('The playbook or skill slug. Omit for the one on the page.'),
        kind: z.enum(['playbook', 'skill']).optional().describe('Which folder, when you know. Omit to try playbooks/ then skills/.'),
      }),
    },
  );
}

export function writePlaybookTool(ctx: RuntimeContext) {
  return tool(
    async input => writeSource(ctx, 'playbook', input as { slug?: string; kind?: 'playbook' | 'skill'; content: string; reason: string; confidence: number }),
    {
      name: 'write_playbook',
      description: 'Change a playbook or a skill by writing its WHOLE SKILL.md back — frontmatter and body. This is how you answer "tighten the second section", "add a step about X" or "Change this: …" on a playbook page: read_playbook, edit the text, write_playbook. Goes through review: a person approves the diff (the default), then the file is written, versioned and applied. Keep the frontmatter valid (slug, name, description).',
      schema: z.object({
        slug: z.string().min(1).optional().describe('The playbook or skill slug. Omit for the one on the page.'),
        kind: z.enum(['playbook', 'skill']).optional().describe('Which folder. Omit for the one on the page, or `playbook` when creating.'),
        ...writeShape,
      }),
    },
  );
}

/**
 * The workspace-source tool set — on for every agent; the write is gated by its action.
 * @param ctx
 */
export function workspaceSourceTools(ctx: RuntimeContext) {
  return [readMissionTool(ctx), writeMissionTool(ctx), readPlaybookTool(ctx), writePlaybookTool(ctx)];
}
