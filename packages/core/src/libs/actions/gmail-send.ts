/**
 * gmail.send — send an email (or create a draft) as the connected Gmail user.
 *
 * `external: true` + grant `send_email` → an agent proposing this is gated into
 * the review queue by the autonomy model; a human/token with the grant can run
 * it directly. Credentials come from the `gmail` source's vault entry. When
 * `draft: true`, creates a Gmail draft instead of sending — the safe default
 * for "draft my emails, I'll send."
 */

import type { Action } from './types';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

const gmailSendInput = z.object({
  to: z.string().min(1),
  subject: z.string().default(''),
  body: z.string().min(1),
  cc: z.string().optional(),
  /** Create a draft instead of sending. */
  draft: z.boolean().default(false),
  baseUrl: z.string().url().default('https://gmail.googleapis.com/gmail/v1'),
});

function toRfc822(input: { to: string; subject: string; body: string; cc?: string }): string {
  const lines = [
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : null,
    `Subject: ${input.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  ].filter((l): l is string => l !== null);
  // Gmail wants base64url of the raw RFC-822 message.
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export const gmailSendAction: Action<typeof gmailSendInput> = {
  id: 'gmail.send',
  name: 'Send email',
  description: 'Send an email, or create a draft, as the connected Gmail user.',
  inputSchema: gmailSendInput,
  grant: 'send_email',
  external: true,
  sourceSlug: 'gmail',
  async execute(ctx, input) {
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('gmail.send requires connected Gmail credentials (credentials.token)');
    }
    const raw = toRfc822(input);
    const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' };

    if (input.draft) {
      const res = await fetch(`${input.baseUrl}/users/me/drafts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: { raw } }),
      });
      if (!res.ok) {
        throw new Error(`Gmail draft failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as { id?: string; message?: { id?: string } };
      return { mode: 'draft', draftId: body.id ?? null, messageId: body.message?.id ?? null, to: input.to };
    }

    const res = await fetch(`${input.baseUrl}/users/me/messages/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      throw new Error(`Gmail send failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const body = (await res.json()) as { id?: string; threadId?: string };
    return { mode: 'sent', messageId: body.id ?? null, threadId: body.threadId ?? null, to: input.to };
  },
};
