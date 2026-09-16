/**
 * Agent tools for the memory store's rule namespaces.
 *
 * The agent reads its mounted namespaces as files under `/memories/…`
 * (rendered into every model call by the digest middleware, and readable
 * via deepagents's built-in `read_file`). These tools cover the write path
 * (and dedup checks) — committing only after the user approves a candidate
 * proposed by the self-improver subagent. Direct file writes under
 * `/memories/` are denied in both loops; these tools ARE the gate-side API.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  addRule,
  checkDedup,
  getNamespace,
  listNamespaces,
  removeRule,
  updateRule,
} from '@/services/MemoryService';

export function listLearningStepsTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const steps = await listNamespaces(ctx.orgId);
      return steps
        .map(s => `- **${s.name}** (${s.title}, ${s.ruleCount} rule${s.ruleCount === 1 ? '' : 's'}): ${s.description}`)
        .join('\n');
    },
    {
      name: 'list_learning_steps',
      description: 'List the available learning-step buckets this agent can read from and write to (e.g. global, meeting_triage). Use before proposing a new rule so you bucket it correctly.',
      schema: z.object({}),
    },
  );
}

export function getLearningsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const data = await getNamespace(ctx.orgId, args.step);
      return JSON.stringify(data, null, 2);
    },
    {
      name: 'get_learnings',
      description: 'Read the active rules for a single learning step. Returns step metadata and the rule list as JSON.',
      schema: z.object({ step: z.string() }),
    },
  );
}

export function checkLearningDedupTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const r = await checkDedup(ctx.orgId, args.step, args.rule);
      if (r.ok) {
        return JSON.stringify({ ok: true, message: 'no near-duplicate' });
      }
      return JSON.stringify({
        ok: false,
        existingKey: r.existingKey,
        existingRule: r.existingRule,
        similarity: r.similarity,
      });
    },
    {
      name: 'check_learning_dedup',
      description: 'Check whether a candidate rule is a near-duplicate of an existing rule in the given step (trigram similarity ≥ 0.72). Use before proposing rules to avoid noise.',
      schema: z.object({ step: z.string(), rule: z.string() }),
    },
  );
}

export function addLearningTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const r = await addRule({
        orgId: ctx.orgId,
        stepName: args.step,
        ruleText: args.rule,
        source: args.source,
        createdBy: ctx.userId,
      });
      if (!r.ok) {
        return JSON.stringify({ ok: false, error: r.error, detail: r.detail, existing: r.existing });
      }
      return JSON.stringify({ ok: true, ruleKey: r.rule?.key });
    },
    {
      name: 'add_learning',
      description: 'Commit a new rule to a learning step. ONLY call this after the user has explicitly approved the candidate. Rejects near-duplicates of existing rules.',
      schema: z.object({
        step: z.string(),
        rule: z.string(),
        source: z.string().optional().describe('provenance, e.g. "feedback:42" or "self-improver:run_17"'),
      }),
    },
  );
}

export function updateLearningTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const r = await updateRule({ orgId: ctx.orgId, key: args.ruleKey, ruleText: args.rule });
      return JSON.stringify(r);
    },
    {
      name: 'update_learning',
      description: 'Replace the text of an existing rule. Preserves the rule key, source, and createdAt. ruleKey is the rule\'s /memories/… path from get_learnings.',
      schema: z.object({ ruleKey: z.string(), rule: z.string() }),
    },
  );
}

export function removeLearningTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const r = await removeRule({ orgId: ctx.orgId, key: args.ruleKey });
      return JSON.stringify(r);
    },
    {
      name: 'remove_learning',
      description: 'Retract a rule by its /memories/… key. Use sparingly — usually it is better to update than to remove.',
      schema: z.object({ ruleKey: z.string() }),
    },
  );
}

/**
 * remember_preference — the preference fast lane.
 *
 * The one write that skips waiting on a reviewer: an explicit "remember
 * this" from the person in the conversation is applied immediately at USER
 * scope (their own /memories/users/<id>/preferences bucket) and lands on the
 * review queue already-approved, so a reviewer is notified and can revoke.
 * Structurally incapable of changing anyone else's behavior.
 * @param ctx
 */
export function rememberPreferenceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { recordFastLanePreference } = await import('@/services/LearningCandidateService');
      const r = await recordFastLanePreference({
        orgId: ctx.orgId,
        userId: ctx.userId,
        text: args.preference,
        agentSlug: ctx.agentSlug,
      });
      if (!r.ok) {
        return JSON.stringify(r.error === 'no_user'
          ? { ok: false, error: 'no_user', detail: 'This turn has no signed-in user; preferences can only be remembered for a person.' }
          : r);
      }
      return JSON.stringify({ ok: true, ruleKey: r.ruleKey, note: 'Saved to this user\'s preferences; a reviewer is notified and can revoke.' });
    },
    {
      name: 'remember_preference',
      description: 'Save a PERSONAL preference the current user explicitly asked you to remember ("remember that I…", "always address me as…"). Applies immediately, for THIS user only, and notifies a reviewer. For team-wide rules or facts, use add_learning / the feedback loop instead.',
      schema: z.object({
        preference: z.string().describe('The preference as a standalone instruction, naming no other people.'),
      }),
    },
  );
}
