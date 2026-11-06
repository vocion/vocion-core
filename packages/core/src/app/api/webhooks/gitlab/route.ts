import { NextResponse } from 'next/server';
import { Env } from '@/libs/Env';
import { handleGitlabWebhook } from '@/services/GitlabWebhookService';

/**
 * POST /api/webhooks/gitlab — a GitLab webhook delivery for a project some
 * `gitlab` source lists: a merge request opened, updated with new commits,
 * approved, merged or closed; a pipeline finished on a merge request or on the
 * deploy branch. Each becomes the event the `gitlab` connector would have
 * emitted on its next poll, with the same dedupe key, so the poll and the
 * webhook can both run and nothing fires twice.
 *
 * The discipline is the GitHub receiver's: the secret is checked
 * (`X-Gitlab-Token` against `GITLAB_WEBHOOK_SECRET`, constant-time) BEFORE the
 * body is parsed; a delivery that fails it is a 401, never a 200; a
 * deployment with no secret answers 501 and relies on polling alone.
 * Automations are dispatched in the background so the ack goes back inside
 * GitLab's ten-second window.
 * @param request - Raw request.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const outcome = await handleGitlabWebhook({
    rawBody: raw,
    headers: request.headers,
    secret: Env.GITLAB_WEBHOOK_SECRET,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
