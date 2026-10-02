import type { ChannelOutcome, NotificationMessage } from './outcome';
import process from 'node:process';
import { SLACK_API_BASE, slackApi } from '@/libs/surfaces/slack';

/**
 * SLACK (backlog 048) — through the Slack surface's own install
 * (`libs/surfaces/slack.ts`: one Slack app per deployment, `SLACK_BOT_TOKEN`).
 * A DM to the person, found by their email (`users.lookupByEmail`, scope
 * `users:read.email`), or a post in the workspace's bound Slack channel when
 * the person chose that. Without the token the channel is "not configured".
 */

export function slackToken(env: Record<string, string | undefined> = process.env): string | null {
  return env.SLACK_BOT_TOKEN?.trim() || null;
}

/**
 * The text a Slack notification carries: title bold, body, and the link.
 * @param message
 */
export function slackText(message: NotificationMessage): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [`*${esc(message.title)}*`, message.body ? esc(message.body) : null, message.url ? `<${message.url}|Open in Vocion>` : null].filter(Boolean).join('\n');
}

/**
 * The person's Slack user id, from their email.
 * @param email - The person's email.
 * @param token - Bot token.
 * @param fetchImpl - Injectable for tests.
 * @param baseUrl - Overridable for tests.
 */
async function lookupSlackUser(email: string, token: string, fetchImpl: typeof fetch, baseUrl: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // A read method: form-encoded, not JSON.
  const res = await fetchImpl(`${baseUrl}/users.lookupByEmail?${new URLSearchParams({ email })}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }
  const body = await res.json() as { ok?: boolean; error?: string; user?: { id?: string } };
  return body.ok && body.user?.id ? { ok: true, id: body.user.id } : { ok: false, error: body.error ?? 'unknown' };
}

const RETRYABLE = new Set(['ratelimited', 'service_unavailable', 'request_timeout', 'internal_error', 'fatal_error']);

function outcomeOf(error: string, what: string): ChannelOutcome {
  if (error.startsWith('http_5') || error === 'http_429' || RETRYABLE.has(error)) {
    return { status: 'retry', error: `Slack ${what}: ${error}` };
  }
  if (error === 'missing_scope') {
    return { status: 'failed', error: `Slack ${what}: the Slack app is missing a scope (users:read.email to find the person, chat:write to post)` };
  }
  return { status: 'failed', error: `Slack ${what}: ${error}` };
}

/**
 * Send one notification to Slack.
 * @param target - A DM to this email, or a channel id.
 * @param message - What to say.
 * @param token - The bot token, or null.
 * @param opts - Seams for tests.
 * @param opts.fetchImpl
 * @param opts.baseUrl
 */
export async function sendSlack(target: { dmEmail: string } | { channelId: string }, message: NotificationMessage, token: string | null, opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Promise<ChannelOutcome> {
  if (!token) {
    return { status: 'not_configured', error: 'Slack is not configured on this server (SLACK_BOT_TOKEN)' };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? SLACK_API_BASE;
  let channel: string;
  try {
    if ('dmEmail' in target) {
      const user = await lookupSlackUser(target.dmEmail, token, fetchImpl, baseUrl);
      if (!user.ok) {
        return user.error === 'users_not_found'
          ? { status: 'failed', error: 'no Slack member has this person\'s email — choose the workspace channel instead, or use the same email in Slack' }
          : outcomeOf(user.error, 'could not find the person');
      }
      channel = user.id;
    } else {
      channel = target.channelId;
    }
    const posted = await slackApi('chat.postMessage', { channel, text: slackText(message), unfurl_links: false }, token, baseUrl, fetchImpl);
    return posted.ok ? { status: 'sent' } : outcomeOf(posted.error, 'could not post');
  } catch (err) {
    return { status: 'retry', error: `could not reach Slack: ${(err as Error).message}` };
  }
}
