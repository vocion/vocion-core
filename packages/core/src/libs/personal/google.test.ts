/**
 * The personal Google calls: drafts only, never a send, and a draft whose
 * headers cannot be bent by what it quotes.
 *
 * Google has no drafts-only scope — `gmail.compose` also sends — so "never
 * sends" is a property of this code, and the first test holds it there.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { mailDraftReply } = await import('./google');

const grant = { orgId: 'proj-personal-alex', values: { refreshToken: 'rt-alex', clientId: 'cid', clientSecret: 'cs', email: 'alex@northwind.example' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeGmail(original: Record<string, string>) {
  const posted: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
    }
    if (url.includes('/messages/')) {
      return new Response(JSON.stringify({ id: 'm1', threadId: 't1', payload: { headers: Object.entries(original).map(([name, value]) => ({ name, value })) } }));
    }
    if (url.endsWith('/drafts') && init.method === 'POST') {
      posted.push(Buffer.from(JSON.parse(String(init.body)).message.raw, 'base64url').toString('utf8'));
      return new Response(JSON.stringify({ id: 'd1', message: { threadId: 't1' } }));
    }
    return new Response('{}', { status: 404 });
  }));
  return posted;
}

describe('personal Gmail', () => {
  it('has no path that sends mail: no messages.send, no drafts.send', () => {
    const source = readFileSync(fileURLToPath(new URL('./google.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/\/send\b/);
    expect(source).not.toMatch(/:send\b/);
  });

  it('threads the draft under the mail it answers and replies to the Reply-To', async () => {
    const posted = fakeGmail({ 'From': 'Dana <dana@contoso.example>', 'Reply-To': 'deals@contoso.example', 'Subject': 'Renewal terms', 'Message-ID': '<m1@contoso.example>', 'References': '<m0@contoso.example>' });

    const draft = await mailDraftReply(grant, { messageId: 'm1', body: 'Line one\nLine two' });

    expect(draft).toMatchObject({ draftId: 'd1', threadId: 't1', to: 'deals@contoso.example', subject: 'Re: Renewal terms' });
    expect(draft?.link).toBe('https://mail.google.com/mail/?authuser=alex%40northwind.example#drafts');
    expect(posted[0]).toContain('In-Reply-To: <m1@contoso.example>\r\nReferences: <m0@contoso.example> <m1@contoso.example>');
    expect(posted[0]).toContain('\r\n\r\nLine one\r\nLine two');
  });

  it('a subject or address carrying a line break cannot add a header', async () => {
    const posted = fakeGmail({ 'From': 'x@contoso.example\r\nBcc: spy@contoso.example', 'Subject': 'Hi\r\nBcc: spy@contoso.example', 'Message-ID': '<m1@contoso.example>' });

    await mailDraftReply(grant, { messageId: 'm1', body: 'ok' });

    const headers = posted[0]!.split('\r\n\r\n')[0]!;

    expect(headers.split('\r\n').some(line => line.startsWith('Bcc:'))).toBe(false);
  });

  it('encodes a subject that is not plain ASCII', async () => {
    const posted = fakeGmail({ 'From': 'dana@contoso.example', 'Subject': 'Café opening', 'Message-ID': '<m1@contoso.example>' });

    await mailDraftReply(grant, { messageId: 'm1', body: 'ok' });

    expect(posted[0]).toContain(`Subject: =?UTF-8?B?${Buffer.from('Re: Café opening', 'utf8').toString('base64')}?=`);
  });
});
