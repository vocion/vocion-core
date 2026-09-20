/**
 * agent.revise_prompt — an agent revises its own instructions.
 *
 * This is the sharpest member of the self-improvement class and it is in the
 * class on purpose, at the highest bar in it. The argument for including it:
 * the correction an agent gets most often is about HOW it works, not about a
 * fact, and today the only place that correction can land is a person editing
 * a prompt file. The argument against — a self-modifying prompt is how an
 * agent drifts silently — is answered structurally rather than by excluding
 * it:
 *
 *  - **The highest bar in the class (0.95) and the only `medium` risk tier in
 *    it.** A medium tier never auto-executes on the platform default, so a
 *    workspace that has authored no `trust.yaml` rule for this kind gets "a
 *    person decides", every time, with no flag to forget. Making it run on
 *    its own is one explicit rule, in a file, in git.
 *  - **Nothing drifts silently.** Every revision shows the diff — on the
 *    review card, in the chat chip (which agent, how many lines moved), and
 *    on the Activity row. Principle 10: the change is traceable in one move
 *    from where it is read.
 *  - **Undo restores the exact prior text, not a regenerated one.** `execute`
 *    records the whole previous prompt on the run, so `undo` writes those
 *    bytes back. A prompt an agent "restores from memory" is a second
 *    revision wearing the first one's name.
 *  - **An undo demotes the kind.** `ActionService.undoAction` already calls
 *    `holdAfterUndo`, so one wrong self-revision puts this kind back to
 *    asking, for that workspace, without anybody filing anything.
 *
 * It writes the workspace file that authors the prompt, never the `agent`
 * row: a column write would be reverted by the next apply. An agent whose
 * prompt this workspace does not author — one a plugin ships, one hired
 * straight into the database — is refused at `precheck` with the door,
 * rather than at execute time with a failed card.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const revisePromptInput = z.object({
  /** The agent whose instructions change, by slug. */
  slug: z.string().min(1).max(120),
  /** The WHOLE new system prompt. A partial prompt is a broken agent. */
  prompt: z.string().min(40).max(60_000),
  /** Why — what was observed that these instructions did not cover. */
  reason: z.string().min(1).max(500),
});

export type AgentRevisePromptInput = z.infer<typeof revisePromptInput>;

async function locate(ctx: ActionContext, slug: string) {
  const { workspaceDirFor } = await import('@/services/selfUpdate/workspaceDoc');
  const { locateAgentPrompt } = await import('@/services/selfUpdate/agentPrompt');
  const dir = await workspaceDirFor(ctx.orgId);
  return { dir, at: dir ? locateAgentPrompt(dir, slug) : null };
}

async function agentName(orgId: string, slug: string): Promise<string> {
  const { getAgent } = await import('@/services/AgentService');
  try {
    return (await getAgent(orgId, slug))?.name ?? slug;
  } catch {
    return slug;
  }
}

export const agentRevisePromptAction: Action<typeof revisePromptInput> = {
  id: 'agent.revise_prompt',
  name: 'Revise an agent\'s instructions',
  description: 'Replace an agent\'s system prompt in the workspace that authors it, and apply. The highest bar of any self-update: it changes every turn that agent takes afterwards, so it shows the diff and a person decides unless a workspace trust rule says otherwise. Reversible — the exact previous prompt is one Undo away.',
  inputSchema: revisePromptInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `agent.revise_prompt:${input.slug.toLowerCase()}`,
  async precheck(ctx, input) {
    const { workspaceDocBlocker } = await import('@/services/selfUpdate/workspaceDoc');
    const { dir, at } = await locate(ctx, input.slug);
    const blocker = workspaceDocBlocker(dir);
    if (blocker) {
      return `instructions cannot be revised from here: ${blocker}`;
    }
    if (!at) {
      return `this workspace does not author "${input.slug}"'s instructions — the agent comes from a plugin or the catalog, so its prompt is changed where it is shipped from, not here`;
    }
    return undefined;
  },
  async reviewCard(ctx, input) {
    const { diffLines } = await import('./selfUpdate');
    const { at } = await locate(ctx, input.slug);
    const diff = diffLines(at?.text ?? '', input.prompt);
    const name = await agentName(ctx.orgId, input.slug);
    return {
      title: `Revise instructions: ${name}`,
      system: 'Agent',
      summary: input.reason,
      confidenceSubject: 'These instructions are right',
      fields: [
        { label: 'Agent', value: `${name} (${input.slug})`, href: `/dashboard/agents/${input.slug}` },
        { label: 'Authored in', value: at?.relPath ?? 'not authored in this workspace' },
        { label: 'Change', value: diff.summary },
        // The diff IS the receipt for this kind: a prompt rewrite read as
        // prose hides what actually moved.
        { label: 'What changed', value: diff.preview.join('\n') || 'nothing — the prompt is unchanged' },
      ],
      nextAction: 'Approving rewrites the prompt file and applies the workspace; every turn this agent takes afterwards uses it. The exact previous text stays on this run for Undo.',
      // One word: the review bar suffixes the verb to announce the decision
      // ("Revised · …"), so a phrase here comes back as "Revise instructionsed".
      verbs: { approve: 'Revise', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { writeAgentPrompt } = await import('@/services/selfUpdate/agentPrompt');
    const { diffLines } = await import('./selfUpdate');
    const { dir, at } = await locate(ctx, input.slug);
    if (!dir || !at) {
      throw new Error(`this workspace does not author "${input.slug}"'s instructions`);
    }
    const diff = diffLines(at.text, input.prompt);
    const res = await writeAgentPrompt({
      orgId: ctx.orgId,
      dir,
      at,
      prompt: input.prompt,
      appliedBy: ctx.invokedBy ?? 'agent.revise_prompt',
    });
    return {
      slug: input.slug,
      agentName: await agentName(ctx.orgId, input.slug),
      // The exact bytes that were there. Undo writes these back; it never
      // asks a model to reconstruct them.
      previousPrompt: at.text,
      shape: at.shape,
      relPath: at.relPath,
      workspaceDir: dir,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      change: diff.summary,
      applied: res.applied,
      href: `/dashboard/agents/${input.slug}`,
    };
  },
  async undo(ctx, input, result) {
    const { writeAgentPrompt } = await import('@/services/selfUpdate/agentPrompt');
    const previous = result.previousPrompt;
    if (typeof previous !== 'string') {
      return { undone: false, reason: 'the previous prompt was not recorded on this run' };
    }
    const dir = typeof result.workspaceDir === 'string' ? result.workspaceDir : (await locate(ctx, input.slug)).dir;
    if (!dir) {
      return { undone: false, reason: 'no workspace directory on this host' };
    }
    const shape = result.shape === 'inline' ? 'inline' as const : 'file' as const;
    const relPath = typeof result.relPath === 'string' ? result.relPath : '';
    const res = await writeAgentPrompt({
      orgId: ctx.orgId,
      dir,
      at: { shape, relPath },
      prompt: previous,
      appliedBy: `${ctx.invokedBy ?? 'agent.revise_prompt'}:undo`,
    });
    return { undone: true, restoredChars: previous.length, applied: res.applied };
  },
};
