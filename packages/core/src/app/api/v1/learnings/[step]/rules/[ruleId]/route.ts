import { NextResponse } from 'next/server';
import { getNamespace, namespaceFilePrefix, removeRule, updateRule } from '@/services/MemoryService';
import { authApi, isErrorResponse, jsonError } from '../../../../_shared';

/**
 * PATCH / DELETE a learning rule. Rules live in the memory store keyed by
 * their file path (`/memories/<namespace path>/<slug>.md`); the URL addresses
 * one by its `<slug>` (with or without the `.md`), resolved against the step
 * in the path — so the URL stays clean and the step is load-bearing now.
 */

/**
 * Resolve the URL's (step, ruleId) pair to a store key.
 * @param orgId
 * @param step - Namespace name from the URL.
 * @param ruleId - The rule's file slug, `.md` optional.
 */
async function resolveKey(orgId: string, step: string, ruleId: string): Promise<string | null> {
  try {
    const ns = await getNamespace(orgId, step);
    const slug = ruleId.endsWith('.md') ? ruleId : `${ruleId}.md`;
    return `${namespaceFilePrefix(ns.path)}${slug}`;
  } catch {
    return null;
  }
}

/**
 * PATCH /api/v1/learnings/:step/rules/:ruleId  { ruleText }
 *
 * Rewrite one learning rule in place. `ruleText` is required and replaces the
 * rule's whole body — this is not a merge. 404 when the step is not a
 * namespace in this org, or the rule is not in it.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function PATCH(req: Request, context: { params: Promise<{ step: string; ruleId: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { step, ruleId } = await context.params;
  const key = await resolveKey(caller.orgId, step, ruleId);
  if (!key) {
    return jsonError('NOT_FOUND', `unknown learning step ${JSON.stringify(step)}`, 404);
  }

  let body: { ruleText?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
  }
  if (typeof body.ruleText !== 'string' || body.ruleText.trim().length === 0) {
    return jsonError('INVALID_BODY', '`ruleText` is required (non-empty string)', 400);
  }

  const result = await updateRule({ orgId: caller.orgId, key, ruleText: body.ruleText });
  if (!result.ok) {
    return jsonError('NOT_FOUND', `learning rule ${ruleId} not found`, 404);
  }
  return NextResponse.json(result.rule);
}

/**
 * DELETE /api/v1/learnings/:step/rules/:ruleId
 *
 * Remove one learning rule. Returns the store key that was removed, so a
 * caller can see which file went. 404 when the step is not a namespace in this
 * org, or the rule is not in it.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function DELETE(req: Request, context: { params: Promise<{ step: string; ruleId: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { step, ruleId } = await context.params;
  const key = await resolveKey(caller.orgId, step, ruleId);
  if (!key) {
    return jsonError('NOT_FOUND', `unknown learning step ${JSON.stringify(step)}`, 404);
  }
  const result = await removeRule({ orgId: caller.orgId, key });
  if (!result.ok) {
    return jsonError('NOT_FOUND', `learning rule ${ruleId} not found`, 404);
  }
  return NextResponse.json({ removedKey: result.removedKey });
}
