import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ dryRun: true }] }) }) }) } }));
const send = vi.hoisted(() => vi.fn());
vi.mock('@/libs/mail/resend', () => ({ sendViaResend: send }));
const { sendMail } = await import('@/libs/mail');

afterEach(() => vi.unstubAllEnvs());

it('blocks unbranded workspace mailbox replies before the transport is reached', async () => {
  vi.stubEnv('VOCION_MAIL_ENABLED', '1');

  await expect(sendMail({ workspaceId: 'held', to: 'person@example.test', subject: 'Reply', html: '<p>Draft</p>' })).rejects.toThrow('dry run');
  expect(send).not.toHaveBeenCalled();
});

it('also applies the hold to branded workspace reports and notifications', async () => {
  vi.stubEnv('VOCION_MAIL_ENABLED', '1');

  await expect(sendMail({ brand: { orgId: 'held' }, to: 'person@example.test', subject: 'Report', html: '<p>Draft</p>' })).rejects.toThrow('dry run');
  expect(send).not.toHaveBeenCalled();
});
