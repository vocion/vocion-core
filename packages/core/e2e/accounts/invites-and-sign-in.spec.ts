import type { Browser, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * The invite system and sign-in, end to end, against the running app.
 *
 * - An admin invites an address from Members; the invite mail ("Join <Org>
 *   on Vocion") is captured by the dev mail sink (`VOCION_MAIL_SINK_DIR`, set
 *   for the test server in playwright.config.ts; mail itself stays off); its
 *   link is accepted with a password; the new member opens the Org's
 *   workspaces and nothing else.
 * - An invite is accepted by a Google sign-in whose verified address matches
 *   it. The provider is simulated at the decision function
 *   (`support/simulate-provider-sign-in.ts` runs the app's own Auth.js
 *   callbacks and seals the session cookie); the browser then carries that
 *   cookie into the app.
 * - Expired and revoked invites are refused by the form and by the provider.
 * - Forgot password: the reset mail from the sink sets a new password that
 *   signs in; an unknown address gets the same answer and no mail.
 * - Multi-Org servers only: a login invited into a second Org joins it at its
 *   next password sign-in, with no form; and a member who stays signed in hears
 *   of another Org's invite in the app and joins it from their profile in one
 *   click (skipped unless VOCION_ORGS=multi on a server built with an extension
 *   that allows it — see `support/multi-org-extension`).
 */

test.describe.configure({ mode: 'serial' });

const SEED_SCRIPT = 'e2e/accounts/support/seed-accounts-fixtures.ts';
const SIMULATE_SCRIPT = 'e2e/accounts/support/simulate-provider-sign-in.ts';
const SINK = process.env.VOCION_MAIL_SINK_DIR ?? 'e2e/.mail-sink';

// Must match the seed script.
const ORG = 'E2E Accounts Northwind';
const KESTREL = 'E2E Accounts Kestrel';
const CONTOSO = 'E2E Accounts Contoso';
const IDA = { email: 'accounts-ida@northwind.example', password: 'accounts-e2e-ida-pass-1' };
const CARA = { email: 'accounts-cara@northwind.example', password: 'accounts-e2e-cara-pass-1' };
const ADMIN = { email: 'accounts-admin@northwind.example', name: 'Ada Admin', password: 'accounts-e2e-admin-pass-1' };
const PAT = { email: 'accounts-pat@northwind.example', password: 'accounts-e2e-pat-pass-1' };
const OLE = 'accounts-ole@northwind.example';
const LATE = 'accounts-late@northwind.example';
const LATE_TOKEN = 'e2e-accounts-expired-invite-token';

function run(script: string, args: string[] = [], env: Record<string, string> = {}): string {
  try {
    return execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', script, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    throw new Error(`${script} failed: ${stderr.trim().split('\n').at(-1) || String(error)}`);
  }
}

/**
 * A Google sign-in for `email`, simulated at the decision function.
 * @param email
 * @param opts
 * @param opts.verified
 */
function simulateGoogle(email: string, opts: { verified?: boolean } = {}): { refused?: string; userId?: string; cookie?: string } {
  const out = run(SIMULATE_SCRIPT, ['--email', email, '--verified', String(opts.verified ?? true)], {
    // The provider must be "configured" for the gate to consider it; it is never called.
    AUTH_GOOGLE_ID: 'e2e-placeholder-google-client',
    AUTH_GOOGLE_SECRET: 'e2e-placeholder-google-secret',
  });
  return JSON.parse(out.trim().split('\n').at(-1)!);
}

type SinkedMail = { at: string; to: string[]; subject: string; text: string | null; delivered: string | false };

function mailTo(address: string, since: number): SinkedMail[] {
  let names: string[];
  try {
    names = readdirSync(SINK).filter(n => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return names
    .map(n => JSON.parse(readFileSync(join(SINK, n), 'utf8')) as SinkedMail)
    .filter(m => m.to.includes(address) && Date.parse(m.at) >= since);
}

async function waitForMail(address: string, since: number): Promise<SinkedMail> {
  let found: SinkedMail | undefined;

  await expect.poll(() => {
    found = mailTo(address, since).at(-1);
    return Boolean(found);
  }, { message: `a mail to ${address} in ${SINK}`, timeout: 15_000 }).toBe(true);

  return found!;
}

/**
 * Wait until React owns the page's form, so a click runs its handler instead
 * of a native submit (a page compiled on first request can be seconds behind
 * its HTML).
 * @param page - A page showing a form.
 */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector('form');
    return Boolean(form && Object.keys(form).some(k => k.startsWith('__react')));
  });
}

async function signIn(page: Page, login: { email: string; password: string }): Promise<void> {
  await page.goto('/sign-in');
  await hydrated(page);
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password', { exact: true }).fill(login.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(?:w\/[^/]+\/)?dashboard/);
}

function inviteRow(page: Page, email: string) {
  return page.locator('[data-testid^="invite-row-"]').filter({ hasText: email });
}

/**
 * Whether the signed-in person in this page's browser can open a workspace:
 * the app serves it, or answers the 404 it gives an unknown workspace and
 * another Org's alike.
 * @param page - A signed-in page.
 * @param slug - The workspace.
 */
async function canOpen(page: Page, slug: string): Promise<boolean> {
  const res = await page.request.get(`/w/${slug}/dashboard/chat`, { maxRedirects: 0 });
  if (res.status() !== 200 && res.status() !== 404) {
    throw new Error(`/w/${slug} answered ${res.status()}`);
  }
  return res.status() === 200;
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.beforeAll(() => {
  run(SEED_SCRIPT);
});

test('an admin invites an address; the mailed link is accepted with a password; the member opens the Org\'s workspaces', async ({ page, browser }) => {
  const dana = `accounts-dana-${Date.now().toString(36)}@northwind.example`;
  const since = Date.now() - 1000;

  await signIn(page, ADMIN);
  await page.goto('/dashboard/members');
  await page.getByRole('button', { name: 'Invite member' }).click();

  const dialog = page.getByTestId('invite-dialog');
  await dialog.getByLabel('Email').fill(dana);
  // This server sends no mail, so the dialog says so and makes a link to share…
  await dialog.getByRole('button', { name: 'Create link' }).click();

  await expect(dialog.getByText(`Email not sent to ${dana}:`)).toBeVisible();

  // …and the dev mail sink holds exactly the mail that would have gone.
  const mail = await waitForMail(dana, since);

  expect(mail.subject).toBe(`Join ${ORG} on Vocion`);
  expect(mail.text).toContain(`${ADMIN.name} invited you to join ${ORG} on Vocion as a member.`);
  expect(mail.text).toMatch(/until \w+ \d+, \d{4}/);

  const link = /Join E2E Accounts Northwind: (\S+)/.exec(mail.text ?? '')?.[1];

  expect(link).toMatch(/\/sign-up\?invite=/);
  // The row is on the People lane, waiting.
  await expect(inviteRow(page, dana)).toBeVisible();

  // The invitee, in their own browser.
  const invitee = await freshPage(browser);
  await invitee.goto(new URL(link!).pathname + new URL(link!).search);
  await hydrated(invitee);
  await invitee.getByLabel('Your name').fill('Dana Reyes');
  await invitee.getByLabel('Email').fill(dana);
  await invitee.getByLabel('Password', { exact: true }).fill('accounts-e2e-dana-pass-1');
  await invitee.getByRole('button', { name: 'Accept invite + sign in' }).click();
  await invitee.waitForURL(/\/(?:w\/[^/]+\/)?dashboard/);

  expect(await canOpen(invitee, 'e2e-accounts-deals')).toBe(true);
  expect(await canOpen(invitee, 'e2e-accounts-support')).toBe(true);
  // Another Org's workspace is not theirs to open.
  expect(await canOpen(invitee, 'e2e-accounts-kestrel-desk')).toBe(false);

  await invitee.context().close();

  // Spent: the same link refuses a second sign-up.
  const again = await freshPage(browser);
  await again.goto(new URL(link!).pathname + new URL(link!).search);
  await hydrated(again);
  await again.getByLabel('Your name').fill('Someone Else');
  await again.getByLabel('Email').fill(dana);
  await again.getByLabel('Password', { exact: true }).fill('accounts-e2e-other-pass-1');
  await again.getByRole('button', { name: 'Accept invite + sign in' }).click();

  await expect(again.getByText(/already have a login|already been used/)).toBeVisible();

  await again.context().close();
});

test('a Google sign-in whose verified address was invited accepts the invite — no form, no password', async ({ browser, baseURL }) => {
  // An unverified address is refused even though it was invited.
  expect(simulateGoogle(OLE, { verified: false }).refused).toBe('/sign-in?error=AccessDenied&reason=unverified-email&provider=google');

  const signedIn = simulateGoogle(OLE);

  expect(signedIn.refused).toBeUndefined();
  expect(signedIn.userId).toMatch(/^usr-/);

  const page = await freshPage(browser);
  await page.context().addCookies([{ name: 'authjs.session-token', value: signedIn.cookie!, url: baseURL! }]);
  await page.goto('/dashboard');
  await page.waitForURL(/\/(?:w\/[^/]+\/)?dashboard/);

  // Where they land, they are told what they joined.
  await page.goto('/dashboard/notifications');

  await expect(page.getByText(`You joined ${ORG}`)).toBeVisible();

  expect(await canOpen(page, 'e2e-accounts-deals')).toBe(true);
  expect(await canOpen(page, 'e2e-accounts-support')).toBe(true);
  expect(await canOpen(page, 'e2e-accounts-kestrel-desk')).toBe(false);

  // Google is now one of their ways in.
  await page.goto('/dashboard/profile');

  await expect(page.getByText('Google', { exact: true }).first()).toBeVisible();

  await page.context().close();

  // The next Google sign-in is the same person, by the link — not a new login.
  expect(simulateGoogle(OLE).userId).toBe(signedIn.userId);
});

test('expired and revoked invites are refused, by the form and by the provider', async ({ page, browser }) => {
  // Expired: the form says so…
  const late = await freshPage(browser);
  await late.goto(`/sign-up?invite=${LATE_TOKEN}`);
  await hydrated(late);
  await late.getByLabel('Your name').fill('Lee Late');
  await late.getByLabel('Email').fill(LATE);
  await late.getByLabel('Password', { exact: true }).fill('accounts-e2e-late-pass-1');
  await late.getByRole('button', { name: 'Accept invite + sign in' }).click();

  await expect(late.getByText('This invite has expired.')).toBeVisible();

  await late.context().close();

  // …and a provider sign-in for that address finds no invite.
  expect(simulateGoogle(LATE).refused).toBe('/sign-in?error=AccessDenied&reason=no-invite&provider=google');

  // Revoked: an admin invites, copies nothing, revokes from the row.
  const rev = `accounts-rev-${Date.now().toString(36)}@northwind.example`;
  const since = Date.now() - 1000;
  await signIn(page, ADMIN);
  await page.goto('/dashboard/members');
  await page.getByRole('button', { name: 'Invite member' }).click();
  await page.getByTestId('invite-dialog').getByLabel('Email').fill(rev);
  await page.getByTestId('invite-dialog').getByRole('button', { name: 'Create link' }).click();

  await expect(page.getByTestId('invite-dialog').getByText(`Email not sent to ${rev}:`)).toBeVisible();

  const link = /Join E2E Accounts Northwind: (\S+)/.exec((await waitForMail(rev, since)).text ?? '')?.[1];
  await page.getByRole('button', { name: 'Done' }).click();

  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: `Actions for the invite to ${rev}` }).click();
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click();

  await expect(inviteRow(page, rev)).toHaveCount(0);

  const revoked = await freshPage(browser);
  await revoked.goto(new URL(link!).pathname + new URL(link!).search);
  await hydrated(revoked);
  await revoked.getByLabel('Your name').fill('Rae Revoked');
  await revoked.getByLabel('Email').fill(rev);
  await revoked.getByLabel('Password', { exact: true }).fill('accounts-e2e-rev-pass-1');
  await revoked.getByRole('button', { name: 'Accept invite + sign in' }).click();

  await expect(revoked.getByText('Invalid invite token.')).toBeVisible();

  await revoked.context().close();

  expect(simulateGoogle(rev).refused).toBe('/sign-in?error=AccessDenied&reason=no-invite&provider=google');
});

test('a login invited into a second Org joins it at the next sign-in (multi-Org servers)', async ({ page }) => {
  test.skip(process.env.VOCION_ORGS !== 'multi', 'a person in two Orgs needs VOCION_ORGS=multi on a server built with an extension that allows it');

  // Before: Pat is in Northwind only.
  await signIn(page, PAT);

  // The sign-in joined Kestrel's invite: one login, two Orgs, no form.
  expect(await canOpen(page, 'e2e-accounts-kestrel-desk')).toBe(true);
  expect(await canOpen(page, 'e2e-accounts-deals')).toBe(true);

  // And Kestrel's workspace tells them so.
  await page.goto('/w/e2e-accounts-kestrel-desk/dashboard/notifications');

  await expect(page.getByText(`You joined ${KESTREL}`)).toBeVisible();
});

test('a signed-in member invited by another Org hears it in the app and joins from their profile in one click (multi-Org servers)', async ({ page, browser }) => {
  test.skip(process.env.VOCION_ORGS !== 'multi', 'a person in two Orgs needs VOCION_ORGS=multi on a server built with an extension that allows it');

  // Ida is working in Northwind.
  await signIn(page, IDA);

  // Contoso's admin invites her address from their own Members page.
  const admin = await freshPage(browser);
  await signIn(admin, CARA);
  await admin.goto('/dashboard/members');
  await admin.getByRole('button', { name: 'Invite member' }).click();
  await admin.getByTestId('invite-dialog').getByLabel('Email').fill(IDA.email);
  await admin.getByTestId('invite-dialog').getByRole('button', { name: 'Create link' }).click();

  await expect(admin.getByTestId('invite-dialog').getByText(`Email not sent to ${IDA.email}:`)).toBeVisible();

  await admin.context().close();

  // Without signing out, Ida is told, and the notification opens her profile.
  await page.goto('/dashboard/notifications');
  await page.getByText(`${CONTOSO} invited you to join`).click();
  await page.waitForURL(/\/dashboard\/profile/);
  await page.getByRole('button', { name: `Join ${CONTOSO}` }).click();
  // Joined, it opens a workspace in Contoso.
  await page.waitForURL(url => !url.pathname.includes('/profile'));

  expect(await canOpen(page, 'e2e-accounts-contoso-desk')).toBe(true);
  expect(await canOpen(page, 'e2e-accounts-deals')).toBe(true);
});

test('forgot password mails a single-use link that sets a new password; an unknown address gets the same answer and no mail', async ({ page, browser }) => {
  const since = Date.now() - 1000;
  const newPassword = `accounts-e2e-new-${Date.now().toString(36)}`;

  await page.goto('/sign-in');
  await hydrated(page);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.waitForURL(/\/forgot-password/);
  await hydrated(page);
  await page.getByLabel('Email').fill(PAT.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();

  await expect(page.getByText('Check your email')).toBeVisible();

  const mail = await waitForMail(PAT.email, since);

  expect(mail.subject).toBe('Reset your Vocion password');

  const link = /Choose a new password: (\S+)/.exec(mail.text ?? '')?.[1];

  expect(link).toMatch(/\/reset-password#token=/);

  const reset = await freshPage(browser);
  const url = new URL(link!);
  await reset.goto(url.pathname + url.hash);

  await expect(reset.getByLabel('New password', { exact: true })).toBeVisible();

  await reset.getByLabel('New password', { exact: true }).fill(newPassword);
  await reset.getByLabel('Confirm new password').fill(newPassword);
  await reset.getByRole('button', { name: 'Set password' }).click();

  await expect(reset.getByText('Password changed')).toBeVisible();

  await signIn(reset, { email: PAT.email, password: newPassword });
  // Spent.
  await reset.goto(url.pathname + url.hash);

  await expect(reset.getByText('This link has expired')).toBeVisible();

  await reset.context().close();
  PAT.password = newPassword;

  // Nobody at this address: the same page, and nothing in the sink.
  const nobody = `accounts-nobody-${Date.now().toString(36)}@northwind.example`;
  await page.goto('/forgot-password');
  await hydrated(page);
  await page.getByLabel('Email').fill(nobody);
  await page.getByRole('button', { name: 'Send reset link' }).click();

  await expect(page.getByText('Check your email')).toBeVisible();

  await page.waitForTimeout(1500);

  expect(mailTo(nobody, since)).toHaveLength(0);
});
