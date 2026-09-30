import { NextResponse } from 'next/server';
import { handleGithubAppWebhook } from '@/services/GithubWebhookService';

/**
 * POST /api/webhooks/github-app — a delivery to the deployment's GitHub App
 * (backlog 053): installation changes, and the same pull request, check and
 * workflow deliveries the per-repository webhook receives, for every
 * repository the app is installed on. Verified with the app's own webhook
 * secret from the vault before the body is parsed; 501 before an app exists.
 * @param request - Raw request.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const outcome = await handleGithubAppWebhook({ rawBody: raw, headers: request.headers });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
