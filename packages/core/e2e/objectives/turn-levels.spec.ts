import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { ADMIN, seedDecisionsWorkspace } from '../decisions/support/seed';

/**
 * LIVE LINE, THEN STEPS, THEN RAW DETAIL — and "N running ›" (founder,
 * 2026-10-09, after Claude Code's "1 background task stopped, 1 running ›":
 * "it hides complexity so well, while allowing click to explorability").
 *
 * Asserted on a phone (390×844) and a desktop (1440×900):
 * - while a turn works, ONE line says what is happening, with the clock;
 * - a finished turn is one line with how long it took ("· 41s"); nothing
 *   under it until tapped (level 1 only by default);
 * - tapped, its steps are sentences — a failed step says it failed, in words,
 *   and carries no error text; a consult is its own folded line;
 * - tapped again, the failed step shows the error and Copy details (level 3);
 * - the "N running ›" chip opens a side panel (desktop) or a sheet (phone)
 *   listing the running mission with Stop and a folded "Finished 1"; Stop
 *   cancels it.
 *
 * The finished turn's trace is written to the database rather than played,
 * so the steps (a consult, a failure) are exactly the ones asserted; the live
 * turn is played by the scripted model. Run with `npm run e2e:objectives`;
 * `TURN_LEVEL_SHOTS` names a directory for the screenshots. Fixtures are
 * fictional (Northwind, Kestrel).
 */

const SHOTS = process.env.TURN_LEVEL_SHOTS;

test.beforeAll(() => {
  seedDecisionsWorkspace();
});

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function shot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
}

async function say(page: Page, line: string) {
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill(line);
  await page.getByRole('button', { name: 'Send message' }).last().click();
}

/**
 * Write a finished turn with a consult and a failed step, a running mission
 * and a finished background task behind the newest conversation.
 * @returns The conversation's id.
 */
async function seedWork(): Promise<number> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // The live turn's row is written after its `done` event: wait for it, so
    // the seeded turn lands after it rather than before.
    await expect.poll(async () => (await db.query(`SELECT count(*)::int AS n FROM conversation_message WHERE conversation_id = (SELECT max(id) FROM conversation) AND role = 'assistant' AND content LIKE '%Northwind renewal can go ahead%'`)).rows[0].n, { timeout: 60_000 }).toBe(1);

    const { rows: [conv] } = await db.query<{ id: number; org_id: string; agent_slug: string }>('SELECT id, org_id, agent_slug FROM conversation ORDER BY id DESC LIMIT 1');
    const t0 = Date.now() - 60_000;
    const lead = { id: conv!.agent_slug, kind: 'lead', name: 'Northwind Lead' };
    const kestrel = { id: 'kestrel-lead', kind: 'specialist', name: 'Kestrel Lead' };
    const trace = [
      { id: 's1', actor: lead, kind: 'search', status: 'done', label: 'Checked 3 workspaces', tool: 'search_knowledge', args: '{"query":"Northwind renewal"}', result: '3 workspaces', startedAt: t0, endedAt: t0 + 9_000 },
      { id: 'd1', actor: lead, kind: 'delegate', status: 'done', label: 'Kestrel answered', detail: 'what did we agree on the Northwind renewal?', labels: { running: 'Asking Kestrel', done: 'Kestrel answered' }, tool: 'ask_workspace', startedAt: t0 + 9_500, endedAt: t0 + 24_000 },
      { id: 'd1a', parentId: 'd1', actor: kestrel, kind: 'search', status: 'done', label: 'Searched the renewal notes', tool: 'search_knowledge', result: '2 sources', startedAt: t0 + 10_000, endedAt: t0 + 15_000 },
      { id: 'd1b', parentId: 'd1', actor: kestrel, kind: 'tool', status: 'done', label: 'Read the 2025 contract', tool: 'read_document', startedAt: t0 + 15_500, endedAt: t0 + 23_000 },
      { id: 'f1', actor: lead, kind: 'tool', status: 'error', label: 'Posted the summary to Slack — failed', tool: 'post_slack_message', args: '{"channel":"#renewals"}', result: 'Slack is not connected for this workspace', resultDetail: 'ConnectorError: no Slack token for this workspace (connect Slack to post)', startedAt: t0 + 24_500, endedAt: t0 + 26_000 },
      { id: 'r1', actor: lead, kind: 'draft', status: 'done', label: 'Drafted 2 replies', tool: 'draft_reply', startedAt: t0 + 26_500, endedAt: t0 + 41_000 },
    ];
    const answer = 'I checked the three workspaces and drafted two replies for the Northwind renewal. Slack isn\'t connected yet, so the summary was not posted.';
    await db.query(`INSERT INTO conversation_message (conversation_id, role, content, created_at) VALUES ($1, 'user', 'check the renewal across workspaces and draft the replies', now())`, [conv!.id]);
    await db.query(`INSERT INTO conversation_message (conversation_id, role, content, agent_slug, runs_json, trace_json, status, created_at) VALUES ($1, 'assistant', $2, $3, $4, $5, 'complete', now())`, [conv!.id, answer, conv!.agent_slug, JSON.stringify([{ type: 'text', text: answer }]), JSON.stringify(trace)]);
    await db.query(`INSERT INTO mission_run (org_id, title, brief, status, team, created_at) VALUES ($1, 'Reconcile the Northwind invoices', 'Match every Northwind invoice to its order.', 'running', '{"lead":"ops-lead","members":[]}', now() - interval '3 minutes')`, [conv!.org_id]);
    await db.query(`INSERT INTO worker_run (org_id, agent_slug, summary, status, created_at, completed_at) VALUES ($1, 'eng-lead', 'Fix the Kestrel export button', 'completed', now() - interval '50 seconds', now())`, [conv!.org_id]);
    return conv!.id;
  } finally {
    await db.end();
  }
}

for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]] as const) {
  test.describe(device, () => {
    test.use(device === 'phone' ? { viewport, isMobile: true, hasTouch: true } : { viewport });

    test(`one line, then steps, then the error; and N running › (${device})`, async ({ page }) => {
      await signIn(page);
      await page.goto('/dashboard/chat');

      // LIVE: one line, a plain sentence and the clock, updating in place.
      await say(page, 'show me what you checked before the renewal');
      const live = page.getByTestId('streaming-indicator');

      await expect(live).toBeVisible({ timeout: 120_000 });
      await expect(live).toContainText(/setup/i, { timeout: 60_000 });
      await expect(live).toContainText(/\d+s/);
      await expect(page.getByTestId('work-steps-live')).toHaveCount(0);

      await shot(page, `${device}-1-live-line`);

      await expect(page.getByText('the Northwind renewal can go ahead').last()).toBeVisible({ timeout: 120_000 });

      // The seeded turn: a consult, a failed step, and work behind the thread.
      const conversationId = await seedWork();
      await page.goto(`/dashboard/chat/${conversationId}`);

      await expect(page.getByText('drafted two replies for the Northwind renewal')).toBeVisible({ timeout: 60_000 });

      const group = page.getByTestId('work-group').last();

      // LEVEL 1: one line with how long it took; nothing under it.
      await expect(group.getByTestId('work-took')).toHaveText('41s');
      await expect(group.getByTestId('work-steps')).toHaveCount(0);
      await expect(page.getByTestId('failed-step')).toHaveCount(0);
      await expect(page.getByText('no Slack token')).toHaveCount(0);

      await group.scrollIntoViewIfNeeded();
      await shot(page, `${device}-2-folded-line`);

      // LEVEL 2: steps as sentences. The failure says so in words, no error text.
      await group.getByRole('button').first().click();
      const steps = group.getByTestId('work-steps');

      await expect(steps.getByText('Posted the summary to Slack — failed')).toBeVisible();
      await expect(steps.getByText('Kestrel answered')).toBeVisible();
      await expect(steps.getByText('Searched the renewal notes')).toHaveCount(0);
      await expect(page.getByText('Slack is not connected for this workspace')).toHaveCount(0);

      await shot(page, `${device}-3-steps`);

      // The consult opens to its own steps.
      await steps.getByRole('button', { name: /Kestrel answered/ }).click();

      await expect(steps.getByText('Searched the renewal notes')).toBeVisible();

      // LEVEL 3: the failed step's raw detail — inputs, the error, Copy details.
      await steps.getByRole('button', { name: /Posted the summary to Slack/ }).click();
      const failed = page.getByTestId('failed-step');

      await expect(failed).toBeVisible();
      await expect(failed).toContainText('Slack');
      await expect(page.getByTestId('copy-failure')).toBeVisible();

      await failed.scrollIntoViewIfNeeded();
      await shot(page, `${device}-4-raw-detail`);

      // N RUNNING ›: the running mission and the finished task behind the thread.
      const chip = page.getByTestId('running-work-chip');

      await expect(chip).toHaveText(/1 finished, 1 running/, { timeout: 30_000 });

      await chip.scrollIntoViewIfNeeded();
      await shot(page, `${device}-5-chip`);

      await chip.click();
      const panel = page.getByTestId('running-work-panel');

      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('work-item')).toHaveCount(1);
      await expect(panel).toContainText('Reconcile the Northwind invoices');

      await panel.getByTestId('work-finished-toggle').click();

      await expect(panel).toContainText('Fix the Kestrel export button');

      await shot(page, `${device}-6-panel`);

      // Stop cancels the mission; it moves to Finished, stopped.
      await panel.getByTestId('work-item-stop').click();

      await expect(panel.locator('[data-testid=work-item][data-state=stopped]')).toHaveCount(1, { timeout: 30_000 });
      await expect(panel).toContainText('Nothing is running.');
    });
  });
}
