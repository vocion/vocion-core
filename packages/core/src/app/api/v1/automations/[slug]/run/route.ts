import { after, NextResponse } from 'next/server';
import { beginAutomationFire, completeAutomationFire, getAutomation } from '@/services/AutomationService';
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
 * Body: `{ input?: object, dryRun?: boolean, async?: boolean }`
 *   - `input` merges over the authored `do.input` (e.g. `{ day: '2026-08-12' }`
 *     to replay one day). Whatever the job's own input schema accepts.
 *     `input.prompt` replaces a mission check's authored orders for this fire.
 *   - `dryRun` is recorded on the run row AND passed into the input, so a job
 *     that understands rehearsals suppresses its consequential writes. It is
 *     NOT honoured by a mission check: nothing there reads it, so a caller
 *     asking for one on a `checkMission` automation is refused rather than
 *     told a rehearsal happened.
 *   - `async` returns as soon as the fire is recorded and lets the work
 *     continue, which is the only sane mode for a mission check: dispatch
 *     awaits the whole agent loop, so a synchronous call holds the connection
 *     for 2.7 minutes typically and 29 at the observed worst case. Poll
 *     `GET /api/v1/automations/<slug>/runs/<automationRunId>` for the outcome.
 *
 * Without `async` it runs to completion and returns the result, so the CLI and
 * the existing callers are unchanged.
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
  const parsed = (body ?? {}) as { input?: unknown; dryRun?: unknown; async?: unknown };
  if (parsed.input !== undefined && (typeof parsed.input !== 'object' || parsed.input === null || Array.isArray(parsed.input))) {
    return jsonError('INVALID_BODY', '`input` must be a JSON object', 400);
  }
  if (parsed.dryRun !== undefined && typeof parsed.dryRun !== 'boolean') {
    return jsonError('INVALID_BODY', '`dryRun` must be a boolean', 400);
  }
  if (parsed.async !== undefined && typeof parsed.async !== 'boolean') {
    return jsonError('INVALID_BODY', '`async` must be a boolean', 400);
  }
  const dryRun = parsed.dryRun === true;
  const input = { ...(parsed.input as Record<string, unknown> | undefined), ...(dryRun ? { dryRun: true } : {}) };

  const automation = await getAutomation(auth.orgId, slug);
  if (!automation) {
    return jsonError('NOT_FOUND', `No automation found for slug "${slug}"`, 404);
  }
  // A dry run that nothing honours is worse than an honest live one: the flag
  // reached the run row, the mission-check branch never read it, and the row
  // then claimed a rehearsal that had run the full live agent.
  if (dryRun && automation.doConfig.checkMission) {
    return jsonError(
      'DRY_RUN_UNSUPPORTED',
      `automation "${slug}" checks a mission, and a mission check has no dry-run mode: every write tool it can reach would have to honour the flag. Omit dryRun, or pass input.prompt to narrow what the pass does.`,
      400,
    );
  }

  try {
    const pending = await beginAutomationFire(auth.orgId, slug, {
      input,
      invokedBy: 'dashboard:test-run',
      dryRun,
    });
    if (parsed.async === true) {
      // `after` keeps the work alive past the response, so the caller is not
      // holding a connection open for the length of an agent loop. The run row
      // already exists, so the outcome lands there either way.
      after(async () => {
        await completeAutomationFire(pending).catch(() => {
          /* recorded on the run row by completeAutomationFire */
        });
      });
      return NextResponse.json(
        { kind: pending.kind, automationRunId: pending.automationRunId, status: 'running' },
        { status: 202 },
      );
    }
    const fired = await completeAutomationFire(pending);
    return NextResponse.json({ ...fired, status: 'ok' }, { status: 200 });
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
