/**
 * Agent tools for the per-step learnings store (Phase 5).
 *
 * The agent reads its applicable steps as `/learnings/<step>.md` files
 * via deepagents's built-in `read_file` tool. These tools cover the
 * write path (and dedup checks) — committing only after the user
 * approves a candidate proposed by the self-improver subagent
 * (Phase 6).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  addLearning,
  checkDedup,
  getLearnings,
  listSteps,
  removeLearning,
  updateLearning,
} from '@/services/LearningsService';

export function listLearningStepsTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const steps = await listSteps(ctx.orgId);
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
      const data = await getLearnings(ctx.orgId, args.step);
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
        existingId: r.existingId,
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
      const r = await addLearning({
        orgId: ctx.orgId,
        stepName: args.step,
        ruleText: args.rule,
        source: args.source,
        createdBy: ctx.userId,
      });
      if (!r.ok) {
        return JSON.stringify({ ok: false, error: r.error, detail: r.detail, existing: r.existing });
      }
      return JSON.stringify({ ok: true, ruleId: r.rule?.id });
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
      const r = await updateLearning({ orgId: ctx.orgId, ruleId: args.ruleId, ruleText: args.rule });
      return JSON.stringify(r);
    },
    {
      name: 'update_learning',
      description: 'Replace the text of an existing rule. Preserves id, source, and createdAt.',
      schema: z.object({ ruleId: z.number().int().positive(), rule: z.string() }),
    },
  );
}

export function removeLearningTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const r = await removeLearning({ orgId: ctx.orgId, ruleId: args.ruleId });
      return JSON.stringify(r);
    },
    {
      name: 'remove_learning',
      description: 'Retract a rule. Use sparingly — usually it is better to update than to remove.',
      schema: z.object({ ruleId: z.number().int().positive() }),
    },
  );
}
