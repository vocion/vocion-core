import { NextResponse } from 'next/server';
import { fireAutomation, getAutomation } from '@/services/AutomationService';
import { authApi, jsonError } from '../../../_shared';

/**
 * POST /api/v1/automations/<slug>/run — fire an automation now.
 *
 * The on-demand counterpart to the Temporal schedule, and the same code path:
 * it calls `fireAutomation`, so a manual run uses the automation's authored
 * `do.input` and only the overrides passed here differ. That is deliberate —
 * a test run that used its own config would prove nothing about the scheduled
 * one.
 *
 * Body: `{ input?: object, dryRun?: boolean }`
 *   - `input` merges over the authored `do.input` (e.g. `{ day: '2026-08-12' }`
 *     to replay one day). Whatever the job's own input schema accepts.
 *   - `dryRun` is recorded on the run row AND passed into the input, so a job
 *     that understands rehearsals suppresses its consequential writes.
 *
 * Runs synchronously and returns the result, so the caller can show what
 * happened rather than telling the operator to go look somewhere else.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  let body: unknown = null;
  if (req.headers.get('content-length') !== '0') {
    try {
      body = await req.json();
    } catch {
      return jsonError('INVALID_BODY', 'Request body must be valid JSON', 400);
    }
  }
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return jsonError('INVALID_BODY', 'Request body must be a JSON object', 400);
  }
  const parsed = (body ?? {}) as { input?: unknown; dryRun?: unknown };
  if (parsed.input !== undefined && (typeof parsed.input !== 'object' || parsed.input === null || Array.isArray(parsed.input))) {
    return jsonError('INVALID_BODY', '`input` must be a JSON object', 400);
  }
  if (parsed.dryRun !== undefined && typeof parsed.dryRun !== 'boolean') {
    return jsonError('INVALID_BODY', '`dryRun` must be a boolean', 400);
  }
  const dryRun = parsed.dryRun === true;
  const input = { ...(parsed.input as Record<string, unknown> | undefined), ...(dryRun ? { dryRun: true } : {}) };

  const automation = await getAutomation(auth.orgId, slug);
  if (!automation) {
    return jsonError('NOT_FOUND', `No automation found for slug "${slug}"`, 404);
  }

  try {
    const fired = await fireAutomation(auth.orgId, slug, {
      input,
      invokedBy: 'dashboard:test-run',
      dryRun,
    });
    return NextResponse.json(fired, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not active')) {
      return jsonError('AUTOMATION_NOT_ACTIVE', message, 409);
    }
    if (message.includes('not found')) {
      return jsonError('NOT_FOUND', message, 404);
    }
    // The run row already carries the error (fireAutomation records then
    // rethrows), so the failure stays visible on the Automation page too.
    return jsonError('AUTOMATION_RUN_FAILED', message, 500);
  }
}
