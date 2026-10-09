import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * A new chat starts warm, on a phone, with proposals waiting.
 *
 * The founder's screenshot (2026-10-08, iPhone): a new chat opened on a
 * "Waiting on you · Suggested actions 3 of 3" carousel, one big card whose
 * title was its own rationale cut short, a "72%" badge, Approve / Reject, and
 * "Decide in review →". It filled the screen; he could not scroll to the
 * conversation. Now an empty chat is a mark, one warm line and one soft chip
 * by the composer saying how many wait, which opens Review, where the cards
 * live.
 *
 * Self-seeding like the rest of the `queue` project: its own admin, its own
 * object type, three proposals over the same `/api/v1/reviews/propose` an
 * ingestion agent calls. No model key: proposing and drawing the chat need no
 * LLM.
 *
 *   npx playwright test --project=queue warm-chat-start
 */

const ADMIN = {
  name: 'Sam Rivera',
  account: 'Northwind Warm Start',
  email: 'sam@northwind-warm.example',
  password: 'warm-chat-start-1',
};

const OBJECT_TYPE = {
  slug: 'repository_candidate',
  label: 'Repository candidate',
  schema: {
    type: 'object',
    required: ['title'],
    propertyOrder: ['title'],
    properties: { title: { type: 'string', title: 'Repository' } },
  },
};

const RUN_TAG = `run-${Date.now().toString(36)}`;
/** The kind of rationale that used to become the card's title, cut at 120 characters. */
const RATIONALE = 'The operating intent names this as one of three repositories in the factory scope and states its reliability bar, so it belongs on the board.';

const PHONE = { width: 390, height: 844 };

/** An established workspace: a second agent besides the seeded lead (`support/seed-warm-start-agent.ts`). */
function seedAgent(): void {
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', 'e2e/queue/support/seed-warm-start-agent.ts', '--email', ADMIN.email], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`seed-warm-start-agent failed: ${String((error as { stderr?: unknown }).stderr ?? error).trim().split('\n').at(-1)}`);
  }
}

function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      ['run', 'user:create:e2e', '--silent', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    tolerateExistingUser(error, '[warm chat start spec]');
  }
}

test('a new chat on a phone is a warm hello and one soft chip, never the cards', async ({ page }) => {
  createBootstrapAdmin();
  seedAgent();
  await page.setViewportSize(PHONE);

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  const api = page.request;
  const type = await api.post('/api/v1/objects/types', { data: OBJECT_TYPE });

  expect([200, 201, 409]).toContain(type.status());

  for (const n of [1, 2, 3]) {
    const title = `Northwind repository ${n} ${RUN_TAG}`;
    const proposed = await api.post('/api/v1/reviews/propose', {
      data: {
        actionId: 'objects.propose_candidate',
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'A repository the factory already names.',
        input: { objectType: OBJECT_TYPE.slug, title, fields: { title }, dedupOn: ['title'] },
        agentSlug: 'ingestion-lead',
        confidence: 0.72,
        rationale: RATIONALE,
      },
    });

    expect(proposed.ok(), `propose failed: ${await proposed.text()}`).toBeTruthy();
  }

  await page.goto('/dashboard/chat?new=1');

  // One warm line, by first name; no heading, no starters.
  await expect(page.getByTestId('chat-greeting')).toHaveText(/^(Good (morning|afternoon|evening)|Welcome back), Sam\.$/);

  // What waits is one soft chip, with a count; never a card, a carousel or a confidence badge.
  // The opening hint (`libs/chat/openingHints.ts`): what waits is one ranked
  // candidate, "N things need your attention", never a card.
  const nudge = page.locator('[data-testid="opening-hint"][data-type="attention"]');

  await expect(nudge).toContainText(/\d+ things need your attention/);
  await expect(page.getByTestId('recommended-action-card')).toHaveCount(0);
  await expect(page.getByTestId('waiting-on-you')).toHaveCount(0);
  await expect(page.getByText('Suggested actions')).toHaveCount(0);
  await expect(page.getByText('72%')).toHaveCount(0);
  await expect(page.getByText(/operating intent/)).toHaveCount(0);
  // No starter chips: at most two hints, each its own button and its ×.
  expect(await page.getByTestId('opening-hint').count()).toBeLessThanOrEqual(2);
  expect(await page.getByTestId('chat-empty-state').getByRole('button').count()).toBeLessThanOrEqual(4);

  // The conversation pane scrolls, the box you type in is on the screen, and nothing is sideways.
  const layout = await page.evaluate(() => {
    const empty = document.querySelector('[data-testid="chat-empty-state"]') as HTMLElement;
    const box = document.querySelector('textarea')!.getBoundingClientRect();
    const doc = document.scrollingElement!;
    return { overflowY: getComputedStyle(empty).overflowY, composerBottom: box.bottom, sideways: doc.scrollWidth > doc.clientWidth };
  });

  expect(layout.overflowY).toBe('auto');
  expect(layout.composerBottom).toBeLessThanOrEqual(PHONE.height);
  expect(layout.sideways).toBe(false);

  // The chip opens Review, where the cards are.
  await nudge.getByRole('button').first().click();
  await page.waitForURL(/\/dashboard\/inbox/);
});
