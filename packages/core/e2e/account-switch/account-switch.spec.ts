import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * vocion-core#128 — a person in two accounts switches account by switching
 * workspace, and the account sticks.
 *
 * Fixtures come from `support/seed-account-switch-fixtures.ts`: one person in
 * "E2E Switch First" (joined first) and "E2E Switch Second", a `Switch Home`
 * workspace on First, and a workspace with the SAME slug, `e2e-switch-shared`,
 * on each account, plus one colleague per account. The switcher's trigger
 * shows the active workspace's name over its account's name, and the Members
 * page lists the session account's people; all three come from the session's
 * tenancy, so they are what this spec reads.
 *
 * A third account, "E2E Switch Invited", has an open invite for the person:
 * the second test joins it on the login they already have.
 *
 * Accounts are Orgs, and a person in several Orgs exists only on a multi-Org
 * deployment: a single-Org install (the default) refuses the second
 * membership, and only an extension lifts that rule (`services/OrgPolicy.ts`).
 * So this spec needs a server under test built with such an extension and
 * started with `VOCION_ORGS=multi` (`VOCION_ORGS=multi npx playwright test
 * --project=account-switch`), and skips itself otherwise.
 */

test.skip(process.env.VOCION_ORGS !== 'multi', 'a person in several Orgs needs VOCION_ORGS=multi on the server under test');

const SEED_SCRIPT = 'e2e/account-switch/support/seed-account-switch-fixtures.ts';
// Must match the seed script. Duplicated rather than imported because
// importing the script would run it.
const PERSON = { email: 'switch-person@e2e.test', password: 'account-switch-e2e-pass-1' };
// In First only.
const FIRST_COLLEAGUE_LOGIN = { email: 'switch-first-colleague@e2e.test', password: 'account-switch-e2e-pass-2' };
const FIRST_ACCOUNT = 'E2E Switch First';
const SECOND_ACCOUNT = 'E2E Switch Second';
const INVITED_ACCOUNT = 'E2E Switch Invited';
const INVITE_LINK = '/sign-up?invite=e2e-switch-invite-token';
const FIRST_COLLEAGUE = 'First Colleague';
const SECOND_COLLEAGUE = 'Second Colleague';

function seedFixtures(): void {
  // Through `dotenv -c` so the script sees the same env files as the app under test.
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    const reason = stderr.trim().split('\n').at(-1) || (error instanceof Error ? error.message : String(error));
    throw new Error(`${SEED_SCRIPT} failed: ${reason}`);
  }
}

/**
 * The sidebar's switcher button. The sidebar mounts one per layout, so take
 * the one on screen.
 * @param page - The signed-in page.
 */
function switcher(page: Page) {
  return page.getByRole('button', { name: 'Switch workspace' }).filter({ visible: true });
}

/**
 * Open the switcher and pick a workspace under one account's heading.
 * @param page - The signed-in page.
 * @param account - The account heading to pick under.
 * @param workspace - The workspace name to click.
 */
async function switchTo(page: Page, account: string, workspace: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole('group', { name: account }).getByRole('option', { name: new RegExp(workspace) }).click();
}

/**
 * Fill in and submit the sign-in form the page is on.
 * @param page - A page showing the sign-in form.
 * @param login - Who signs in; the person in two accounts by default.
 * @param login.email - Their email.
 * @param login.password - Their password.
 */
async function signIn(page: Page, login: { email: string; password: string } = PERSON): Promise<void> {
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password', { exact: true }).fill(login.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

/**
 * Sign out from the account menu, the way a person does.
 * @param page - A signed-in page.
 */
async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).filter({ visible: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/);
}

test('switching to a workspace on another account moves the whole session there, and it survives a bare /dashboard link', async ({ page }) => {
  seedFixtures();

  await page.goto('/sign-in');
  await signIn(page);

  // Nothing has picked a workspace in this browser yet: the account joined
  // first, and its oldest workspace.
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  await expect(switcher(page)).toContainText('Switch Home');
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);

  // The same slug lives on both accounts. Picking the one under Second must
  // open Second's, not First's.
  await switchTo(page, SECOND_ACCOUNT, 'Shared In Second');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard.*org=e2e-switch-second/);

  await expect(switcher(page)).toContainText('Shared In Second');
  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // A reload keeps them there.
  await page.reload();

  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // A bare link carries no workspace and no account: "last active" must keep
  // them in Second, and the shared slug must resolve there too.
  await page.goto('/dashboard');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard/);

  expect(page.url()).not.toContain('org=');
  await expect(switcher(page)).toContainText('Shared In Second');
  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // The rest of the dashboard moved too: Members lists Second's people, not First's.
  await page.goto('/dashboard/members');

  await expect(page.getByText(SECOND_COLLEAGUE)).toBeVisible();
  await expect(page.getByText(FIRST_COLLEAGUE)).toHaveCount(0);

  // And back across to First's copy of the same slug.
  await switchTo(page, FIRST_ACCOUNT, 'Shared In First');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard.*org=e2e-switch-first/);

  await expect(switcher(page)).toContainText('Shared In First');
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);
  // The switch kept the Members page, now listing First's people.
  await expect(page.getByText(FIRST_COLLEAGUE)).toBeVisible();
  await expect(page.getByText(SECOND_COLLEAGUE)).toHaveCount(0);
});

test('an invite into another account is accepted on the login they already have, and every account stays one switch away', async ({ page }) => {
  seedFixtures();

  // Signed out, the invite link is the sign-up form. They already have a
  // login, so they take its "Sign in" link, which must bring them back here.
  await page.goto(INVITE_LINK);
  await page.getByRole('link', { name: 'Sign in' }).click();
  // Both forms have Email and Password fields, and the sign-up button also
  // says "sign in", so wait for the sign-in page before filling anything.
  await page.waitForURL(/\/sign-in\?callbackUrl=/);
  await signIn(page);
  await page.waitForURL(/\/sign-up\?invite=e2e-switch-invite-token/);

  await expect(page.getByRole('heading', { name: `Join ${INVITED_ACCOUNT}` })).toBeVisible();
  await expect(page.getByText('invited as a member')).toBeVisible();

  await page.getByRole('button', { name: `Join ${INVITED_ACCOUNT}` }).click();

  // Invited's workspace shares its slug with First's and Second's. The landing
  // URL names the account; the dashboard then redirects to its first page
  // without the name, and "last active" must keep them in Invited.
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard/);

  await expect(switcher(page)).toContainText('Shared In Invited');
  await expect(switcher(page)).toContainText(INVITED_ACCOUNT);

  // Same login, so the accounts they already had are still in the switcher.
  await switchTo(page, FIRST_ACCOUNT, 'Switch Home');
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);

  // The link again: nothing left to accept, and a way into the account.
  await page.goto(INVITE_LINK);

  await expect(page.getByRole('heading', { name: `You're already in ${INVITED_ACCOUNT}` })).toBeVisible();
});

/**
 * The account a browser fetch from this tab runs in, as the session says.
 * `/api/auth/session` resolves tenancy like every other call a page makes
 * (`/rpc`, `/api/chat`), from the tab's own URL.
 * @param page - A signed-in tab.
 */
async function sessionAccountOf(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json();
    return session?.user?.accountId as string | undefined;
  });
}

test('two tabs on two accounts each keep their own, even after the other tab switches', async ({ page, context }) => {
  seedFixtures();

  await page.goto('/sign-in');
  await signIn(page);
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  // Wait for the switcher to load before opening it, as the first test does.
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);

  await switchTo(page, SECOND_ACCOUNT, 'Shared In Second');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard/);

  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  const secondAccountId = await sessionAccountOf(page);

  // A second tab opens First's workspace, which moves "last active" to First.
  const otherTab = await context.newPage();
  await otherTab.goto('/w/e2e-switch-home/dashboard');

  await expect(switcher(otherTab)).toContainText(FIRST_ACCOUNT);

  // Calls from the first tab still run in Second, the account it shows.
  expect(secondAccountId).toBeTruthy();
  expect(await sessionAccountOf(page)).toBe(secondAccountId);
  expect(await sessionAccountOf(otherTab)).not.toBe(secondAccountId);
});

test('a different person signing in on the same browser lands in their own account, not the last person\'s', async ({ page, context }) => {
  seedFixtures();

  // The person in two accounts leaves the browser in Second.
  await page.goto('/sign-in');
  await signIn(page);
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);

  const firstAccountId = await sessionAccountOf(page);
  await switchTo(page, SECOND_ACCOUNT, 'Shared In Second');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard/);

  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  await signOut(page);

  // Signing out keeps "last active", still naming Second's workspace.
  expect((await context.cookies()).some(c => c.name === 'vocion_active_project' && c.value !== '')).toBe(true);

  // A colleague who is only in First signs in on the same browser.
  await signIn(page, FIRST_COLLEAGUE_LOGIN);
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  await expect(switcher(page)).toContainText('Switch Home');
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);
  expect(firstAccountId).toBeTruthy();
  expect(await sessionAccountOf(page)).toBe(firstAccountId);

  // Nothing of Second's reaches them: not in the switcher, not in Members.
  await switcher(page).click();

  await expect(page.getByRole('option', { name: /Shared In First/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Shared In Second/ })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.goto('/dashboard/members');

  // First's people, which includes the person who just signed out.
  await expect(page.getByText('Switch Person')).toBeVisible();
  await expect(page.getByText(SECOND_COLLEAGUE)).toHaveCount(0);
});
