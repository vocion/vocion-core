import { NextResponse } from 'next/server';
import { addManualLearning, isCandidateStatus, listCandidates } from '@/services/LearningCandidateService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination, requireCapability } from '../_shared';
import { readActorOverride, readBoundedText } from './_lib';

const RULE_TEXT_MAX = 600;
const POLARITIES = ['correct', 'reinforce'] as const;
const MEMORY_TYPES = ['preference', 'knowledge', 'procedure'] as const;

/**
 * Narrow an optional body value to one of a fixed list.
 * @param value - The raw body value.
 * @param allowed - The values accepted.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  return allowed.find(option => option === value) ?? null;
}

/**
 * GET /api/v1/learning-candidates
 *
 * Rules the system has proposed, adopted or turned down (POST, below, adds one
 * by hand). Filter with `status`
 * (`pending` | `approved` | `rejected`) and `stepName`; page with `limit` and
 * `offset`. Newest first, with the real total for the filters.
 * Auth: tenant API token or dashboard session.
 *
 * Query parameters:
 * - `status` — `pending`, `approved` or `rejected`.
 * - `stepName` — only the candidates proposed for one learning step.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);

  const status = url.searchParams.get('status') ?? undefined;
  if (status !== undefined && !isCandidateStatus(status)) {
    return jsonError('VALIDATION_FAILED', 'status must be one of pending|approved|rejected', 400);
  }

  return NextResponse.json(await listCandidates(caller.orgId, {
    status,
    stepName: url.searchParams.get('stepName') ?? undefined,
    limit,
    offset,
  }));
}

/**
 * POST /api/v1/learning-candidates
 *
 * Add a rule by hand, without waiting for feedback to propose it. The rule
 * goes live in the named step at once and an approved candidate is recorded
 * with it (`addManualLearning`), so it lists with the adopted rules and can be
 * taken back with `POST /api/v1/learning-candidates/:id/unadopt`.
 *
 * Body: `{ step, ruleText, decidedBy?, polarity?, memoryType? }`. `ruleText`
 * is 1–600 characters. `decidedBy` names the person a tenant token acts for, as
 * `<app>:<id>`; only a token may set it. Answers 201 with the candidate and the
 * rule's key; 409 with `details.existing` when it restates a rule already on
 * file (the same shape `…/decide` uses); 400 with `details.step` for a step the
 * workspace does not have. Requires the `approve` capability.
 * Auth: tenant API token or dashboard session.
 * @param req - The request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const step = typeof body.step === 'string' ? body.step.trim() : '';
  if (!step) {
    return jsonError('VALIDATION_FAILED', 'step is required', 400);
  }
  // Required, unlike the reason on unadopt, so missing, blank, not text and
  // too long all get the one message that says what is accepted.
  const ruleText = readBoundedText(body, 'ruleText', RULE_TEXT_MAX);
  if (ruleText === undefined || isErrorResponse(ruleText)) {
    return jsonError('VALIDATION_FAILED', `ruleText must be 1–${RULE_TEXT_MAX} characters`, 400);
  }
  const polarity = oneOf(body.polarity, POLARITIES);
  if (polarity === null) {
    return jsonError('VALIDATION_FAILED', 'polarity must be correct or reinforce', 400);
  }
  const memoryType = oneOf(body.memoryType, MEMORY_TYPES);
  if (memoryType === null) {
    return jsonError('VALIDATION_FAILED', 'memoryType must be preference, knowledge or procedure', 400);
  }
  const decidedBy = readActorOverride(body, 'decidedBy', caller);
  if (isErrorResponse(decidedBy)) {
    return decidedBy;
  }

  const result = await addManualLearning({ orgId: caller.orgId, step, ruleText, decidedBy, polarity, memoryType });
  if (result.ok) {
    return NextResponse.json({ ok: true, candidate: result.candidate, ruleKey: result.ruleKey }, { status: 201 });
  }
  switch (result.error) {
    case 'unknown_step':
      return jsonError('VALIDATION_FAILED', `Unknown learning step ${JSON.stringify(step)}`, 400, { step });
    case 'near_duplicate':
      return jsonError(
        'CONFLICT',
        `This rule is a near-duplicate of existing rule ${result.existing.existingKey}`,
        409,
        { existing: result.existing },
      );
    default:
      return jsonError('VALIDATION_FAILED', `ruleText must be 1–${RULE_TEXT_MAX} characters`, 400);
  }
}
