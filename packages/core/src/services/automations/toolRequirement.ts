/**
 * What `do.requireTool` asks of a run, read one way everywhere.
 *
 * A bare tool name (`record_verdict`) is met by any accepted call of it. A
 * tool and an action — `propose_action:objects.propose_candidate.architecture_plan`
 * — is met only by an accepted `propose_action` for that action (its id or the
 * ladder key its input derives), because "the run proposed something" is not
 * the work (backlog 038: the planner proposed an approval for a plan it never
 * filed, and a bare `propose_action` requirement would have counted it).
 *
 * Accepted means the tool did not refuse: no error, and an answer that does
 * not open with a refusal.
 */

import { policyKeyForRun } from '@/libs/actions/policyKey';

export type ToolRequirement = { tool: string; action: string | null };

const REFUSED = /^"?(?:Not recorded|Proposal refused|Proposal failed|Refused)\b/;

/**
 * @param raw - `do.requireTool` as authored.
 */
export function parseToolRequirement(raw: string): ToolRequirement {
  const at = raw.indexOf(':');
  return at < 0 ? { tool: raw.trim(), action: null } : { tool: raw.slice(0, at).trim(), action: raw.slice(at + 1).trim() || null };
}

/**
 * Whether one answer from a tool is a refusal rather than the work done.
 * @param answer - What the tool returned.
 */
export function isRefusal(answer: unknown): boolean {
  return REFUSED.test(typeof answer === 'string' ? answer : JSON.stringify(answer ?? ''));
}

/**
 * Whether a call's input names the required action.
 * @param req - The requirement.
 * @param input - The call's input (`action_id`, `action_input` for `propose_action`).
 */
export function namesAction(req: ToolRequirement, input: unknown): boolean {
  if (!req.action) {
    return true;
  }
  const i = (input && typeof input === 'object' ? input : {}) as { action_id?: unknown; action_input?: unknown };
  const id = typeof i.action_id === 'string' ? i.action_id : '';
  const actionInput = (i.action_input && typeof i.action_input === 'object' ? i.action_input : {}) as Record<string, unknown>;
  return id === req.action || policyKeyForRun(id, actionInput) === req.action;
}

/**
 * Whether one recorded call meets the requirement.
 * @param req - The requirement.
 * @param call - The call as `tool_call` holds it.
 * @param call.tool - Its tool.
 * @param call.input - Its input.
 * @param call.output - What the tool answered.
 * @param call.error - Its error, when it threw.
 */
export function callMeets(req: ToolRequirement, call: { tool: string; input: unknown; output: unknown; error: string | null }): boolean {
  return call.tool === req.tool && !call.error && !isRefusal(call.output) && !isDryRun(call.input) && namesAction(req, call.input);
}

/**
 * A call made in its tool's look-only mode wrote nothing, so it is not the
 * work an automation requires (Walk 7, 2026-10-02: release #355's QA run
 * called check_live twice with explore, saw the change live, recorded
 * nothing, and the release read "ended without a live check").
 * @param input - The call's input.
 */
export function isDryRun(input: unknown): boolean {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return i.explore === true || i.dry_run === true;
}
