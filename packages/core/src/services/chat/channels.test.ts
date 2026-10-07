/**
 * A conversation's way out, by medium (Chris, 2026-10-06: "Build as foundation"). The email
 * channel against PGlite, with the mail provider stubbed; every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const sent = vi.hoisted(() => ({ mail: [] as Array<Record<string, unknown>> }));
vi.mock('@/libs/mail', async orig => ({ ...(await orig<object>()), mailEnabled: () => true, sendMail: async (m: Record<string, unknown>) => {
  sent.mail.push(m);
  return { id: 'mail-1', skipped: false };
} }));

const { db } = await import('@/libs/DB');
const { conversationSchema, emailThreadSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { channelBySurface, channelFor } = await import('./channels');
const { eq } = await import('drizzle-orm');

const ORG = 'proj-channels-test';
let conversationId = 0;

beforeAll(async () => {
  process.env.VOCION_MAIL_DOMAIN = 'agents.example.com';
  process.env.NEXT_PUBLIC_APP_URL = 'https://vocion.example';
  await db.insert(tenantAccountSchema).values({ id: 'acct-ch', name: 'Test', slug: 'test-ch' } as never).onConflictDoNothing();
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-ch', slug: 'stamp', name: 'Stamp Team', mailboxAddress: 'stamp@agents.example.com', mailboxEnabled: true } as never);
  const [c] = await db.insert(conversationSchema).values({ orgId: ORG, agentSlug: 'product-manager', createdBy: 'email:dana@northwind.example', scopeRef: 'email:in-1@northwind.example', title: 'Upload decks' } as never).returning();
  conversationId = c!.id;
  await db.update(conversationSchema).set({ surface: 'email' }).where(eq(conversationSchema.id, conversationId));
  await db.insert(emailThreadSchema).values([
    { orgId: ORG, conversationId, messageId: 'in-1@northwind.example', direction: 'in', fromAddress: 'dana@northwind.example', subject: 'Upload decks' },
    { orgId: ORG, conversationId, messageId: 'out-1@agents.example.com', direction: 'out', fromAddress: 'stamp@agents.example.com', subject: 'Re: Upload decks' },
  ]);
});

describe('the channel a conversation reaches its person through', () => {
  it('is found by the conversation: a Slack thread, an email thread, or none for the app alone', () => {
    expect(channelFor({ id: 1, surface: 'slack', scopeRef: 'slack:C7:1.1', agentSlug: null })?.surface).toBe('slack');
    expect(channelFor({ id: 2, surface: 'email', scopeRef: 'email:in-1@x', agentSlug: null })?.surface).toBe('email');
    expect(channelFor({ id: 3, surface: 'web', scopeRef: null, agentSlug: null })).toBeNull();
    expect(channelBySurface('email')?.surface).toBe('email');
  });

  it('email: a reply threaded under the person\'s last mail, from the mailbox, files as links, recorded', async () => {
    const email = channelBySurface('email')!;
    const ok = await email.say(ORG, { id: conversationId, surface: 'email', scopeRef: 'email:in-1@northwind.example', agentSlug: 'product-manager' }, 'The plan is ready, and it waits on your approval.', { key: 'k', files: [{ url: '/api/artifacts/m/m.png', caption: 'Mockup: upload page', artifactId: 2106 }], url: null });

    expect(ok).toBe(true);
    expect(sent.mail[0]).toMatchObject({
      from: 'Stamp Team <stamp@agents.example.com>',
      to: 'dana@northwind.example',
      subject: 'Re: Upload decks',
      text: 'The plan is ready, and it waits on your approval.\n\nMockup: upload page: https://vocion.example/dashboard/artifacts/2106',
    });

    const headers = sent.mail[0]!.headers as Record<string, string>;

    expect(headers['In-Reply-To']).toBe('<in-1@northwind.example>');
    expect(headers.References).toBe('<in-1@northwind.example> <out-1@agents.example.com>');

    const rows = await db.select().from(emailThreadSchema).where(eq(emailThreadSchema.conversationId, conversationId));

    expect(rows.filter(r => r.direction === 'out')).toHaveLength(2);
  });
});
