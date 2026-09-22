import process from 'node:process';
import { NextResponse } from 'next/server';
import { handleGithubWebhook } from '@/services/GithubWebhookService';

/**
 * POST /api/webhooks/github — a GitHub webhook delivery for a repository some
 * `github` source lists: pull request opened, synchronized, reviewed, merged
 * or closed, a check suite completed, a workflow run finished on the deploy
 * branch. Each becomes the event the `github` connector would have emitted on
 * its next poll, with the same dedupe key, so the poll and the webhook can
 * both run and nothing fires twice.
 *
 * Same discipline as the Slack and Resend webhooks: the raw body is read once
 * and verified (`X-Hub-Signature-256`, HMAC-SHA256 with
 * `GITHUB_WEBHOOK_SECRET`) BEFORE it is parsed; an unverified request is a
 * 401, never a 200; a deployment with no secret answers 501 and relies on
 * polling alone. Automations are dispatched in the background so the ack goes
 * back inside GitHub's ten-second window.
 * @param request - Raw request.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const outcome = await handleGithubWebhook({
    rawBody: raw,
    headers: request.headers,
    secret: process.env.GITHUB_WEBHOOK_SECRET,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
