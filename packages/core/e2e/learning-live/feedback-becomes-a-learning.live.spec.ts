import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/**
 * The whole feedback-to-learning loop against a REAL model, in the running app.
 *
 *   reject with a reason              → a pending candidate, polarity "correct"
 *   reject again in different words   → the SAME candidate, counted twice
 *   approve with a note               → a second candidate, polarity "reinforce"
 *   approve the first candidate       → an adopted rule carrying the count
 *
 * This is the only spec in the repo that spends money. Every other test — the
 * ingestion spec next door included — stubs the model, per the project rule
 * that tests never make live calls. This one exists because the two model
 * steps in the loop (classify the note, then judge whether the proposed rule
 * restates one already on file) cannot be proven by a stub: a stub answers
 * whatever the test told it to. So it is opt-in and never runs in CI —
 * `playwright.config.ts` only defines the `learning-live` project when
 * LIVE_MODEL_E2E is set.
 *
 * What it needs, all of which must be true before it can pass:
 *
 *   1. The app running, and DATABASE_URL pointing at the SAME database it uses
 *      (the spec seeds a learning step directly, because a step is created by
 *      applying a workspace and there is no API for one).
 *   2. The feedback worker running against that database, with a provider
 *      configured for the `classifier` role. On Bedrock that is:
 *
 *        AWS_PROFILE=veerio AWS_REGION=us-west-2 \
 *        VOCION_LLM_PROVIDER_CLASSIFIER=bedrock \
 *        ENABLE_FEEDBACK_WORKER=1 npm run worker:serve
 *
 *   3. LIVE_MODEL_E2E=1, which is what makes the project exist at all.
 *
 * Running it:
 *
 *   LIVE_MODEL_E2E=1 DATABASE_URL=... npx playwright test --project=learning-live
 *
 * Cost per run: seven Haiku calls (four classifications, three duplicate
 * judgements), all short prompts.
 */

const ADMIN = {
  name: 'Ines Okafor',
  account: 'Veerio Learning',
  email: 'ines@veerio.example',
  password: 'learning-loop-1',
};

/**
 * The step the proposed rules land in. Own name so the spec can clear its own
 * rows without touching anything else in the database.
 */
const STEP_NAME = 'live-e2e-outreach';

/** Keeps each run's action rows apart — `proposeAction` dedups on recipient. */
const RUN_TAG = `run-${Date.now()}`;

/** How long to wait for the worker to pick a job up, classify it and record it. */
const WORKER_TIMEOUT_MS = 90_000;

type Candidate = {
  id: number;
  ruleText: string;
  stepName: string;
  status: string;
  polarity: string;
  occurrenceCount: number;
};

type Rule = { id: number; ruleText: string; occurrenceCount?: number };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must point at the database the running app uses');
  }
  return url;
}

/**
 * Creates the account, its default project and the admin user — the same
 * command an operator runs on a real box. Already exists: the script exits
 * non-zero saying so, and the sign-in below still works.
 */
function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      [
        'run',
        'user:create',
        '--silent',
        '--',
        '--email',
        ADMIN.email,
        '--name',
        ADMIN.name,
        '--account',
        ADMIN.account,
        '--password',
        ADMIN.password,
        '--role',
        'admin',
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    console.warn(`[live learning spec] user:create made no user: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gives the admin's org one learning step and clears anything a previous run of
 * this spec left in it. Without a step there is nowhere for a rule to go and
 * the recorder skips every job, so this is a hard prerequisite rather than
 * convenience seeding.
 *
 * Returns the org id, which is the admin's project id.
 */
async function seedLearningStep(): Promise<string> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const owner = await client.query<{ org_id: string }>(
      `SELECT p.id AS org_id
         FROM "user" u
         JOIN account_membership m ON m.user_id = u.id
         JOIN project p ON p.account_id = m.account_id
        WHERE u.email = $1
        LIMIT 1`,
      [ADMIN.email],
    );
    const orgId = owner.rows[0]?.org_id;
    if (!orgId) {
      throw new Error(`no project found for ${ADMIN.email} — did user:create run against this database?`);
    }

    await client.query(
      `INSERT INTO learning_step (org_id, name, title, description)
            VALUES ($1, $2, 'Live outreach rules', 'Rules learned from reviewer feedback on outreach drafts.')
       ON CONFLICT DO NOTHING`,
      [orgId, STEP_NAME],
    );

    // Start from an empty step: occurrence counts and duplicate judgements are
    // both about what is already on file, so leftovers would change the answer.
    // Candidates name their step by name; adopted rules point at its id.
    const stepRules = `SELECT l.id FROM learning l
                         JOIN learning_step s ON s.id = l.step_id
                        WHERE l.org_id = $1 AND s.name = $2`;
    const stepCandidates = `SELECT id FROM learning_candidate WHERE org_id = $1 AND step_name = $2`;

    await client.query(
      `DELETE FROM learning_feedback_occurrence
        WHERE candidate_id IN (${stepCandidates}) OR learning_id IN (${stepRules})`,
      [orgId, STEP_NAME],
    );
    await client.query(`DELETE FROM learning_candidate WHERE org_id = $1 AND step_name = $2`, [orgId, STEP_NAME]);
    await client.query(`DELETE FROM learning WHERE id IN (${stepRules})`, [orgId, STEP_NAME]);

    return orgId;
  } finally {
    await client.end();
  }
}

test('a reviewer\'s feedback becomes a learning, and a restatement of it does not', async ({ page }) => {
  test.slow();

  createBootstrapAdmin();
  await seedLearningStep();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  const api = page.request;

  // ── A rejection with a reason becomes a proposed rule ────────────────────
  const firstRunId = await proposeOutreach('first');
  await signal(firstRunId, 'reject', 'never email a buyer before their demo has happened — wait until the demo is done');

  const firstCandidate = await waitForCandidateCount(1);

  expect(firstCandidate[0]?.polarity).toBe('correct');
  expect(firstCandidate[0]?.occurrenceCount).toBe(1);
  expect(firstCandidate[0]?.ruleText.trim().length).toBeGreaterThan(0);

  const correctionId = firstCandidate[0]!.id;

  // ── The same complaint, worded differently, is counted not duplicated ────
  // This is the step no stub can prove: the two notes share almost no words,
  // so only a model reading them can tell they ask for the same rule.
  const secondRunId = await proposeOutreach('restatement');
  await signal(secondRunId, 'reject', 'hold off on any outreach to a prospect until after their scheduled demo call');

  await expect(async () => {
    const candidates = await listCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.occurrenceCount).toBe(2);
  }).toPass({ timeout: WORKER_TIMEOUT_MS });

  // ── Praise naming a reusable reason becomes its own candidate ────────────
  const thirdRunId = await proposeOutreach('praise');
  await signal(thirdRunId, 'approve', 'opening with the renewal date was exactly right — always lead with the renewal date');

  const withPraise = await waitForCandidateCount(2);
  const reinforcement = withPraise.find(candidate => candidate.id !== correctionId);

  expect(reinforcement?.polarity).toBe('reinforce');

  // ── Approving the correction adopts it as a rule, count and all ──────────
  const decided = await api.post(`/api/v1/learning-candidates/${correctionId}/decide`, {
    data: { action: 'approve' },
  });

  expect(decided.ok(), `deciding the candidate failed: ${await decided.text()}`).toBeTruthy();

  const adoptedRuleId = (await decided.json()).ruleId as number;
  const rules = await listRules();
  const adopted = rules.find(rule => rule.id === adoptedRuleId);

  expect(adopted, 'the approved candidate did not become a rule').toBeTruthy();
  expect(adopted?.occurrenceCount).toBe(2);

  /**
   * Puts a fresh outreach draft in the review queue and returns its run id.
   * @param label
   */
  async function proposeOutreach(label: string): Promise<number> {
    const res = await api.post('/api/v1/reviews/propose', {
      data: {
        actionId: 'gmail.send',
        input: { to: `buyer+${RUN_TAG}-${label}@example.com`, subject: `${RUN_TAG} ${label}`, body: 'Checking in.' },
        agentSlug: 'sales-assistant',
        confidence: 0.7,
        rationale: 'Deal has been quiet.',
      },
    });

    expect(res.ok(), `propose failed: ${await res.text()}`).toBeTruthy();

    return (await res.json()).runId as number;
  }

  /**
   * Records a reviewer's decision, with the note the classifier will read.
   * @param runId
   * @param kind
   * @param hint
   */
  async function signal(runId: number, kind: 'approve' | 'reject', hint: string): Promise<void> {
    const res = await api.post('/api/v1/reviews/signal', { data: { id: runId, signal: kind, hint } });

    expect(res.ok(), `signal failed: ${await res.text()}`).toBeTruthy();
  }

  /** Pending candidates in this spec's step, newest first. */
  async function listCandidates(): Promise<Candidate[]> {
    const res = await api.get(`/api/v1/learning-candidates?status=pending&stepName=${STEP_NAME}`);

    expect(res.ok(), `listing candidates failed: ${await res.text()}`).toBeTruthy();

    return (await res.json()).items as Candidate[];
  }

  /**
   * Waits for the worker to have recorded exactly `expected` candidates. The
   * wait is the round trip through the queue and the model, so it is slow by
   * nature rather than by flakiness.
   * @param expected
   */
  async function waitForCandidateCount(expected: number): Promise<Candidate[]> {
    let candidates: Candidate[] = [];

    await expect(async () => {
      candidates = await listCandidates();

      expect(candidates).toHaveLength(expected);
    }).toPass({ timeout: WORKER_TIMEOUT_MS });

    return candidates;
  }

  /** Adopted rules in this spec's step. */
  async function listRules(): Promise<Rule[]> {
    const res = await api.get(`/api/v1/learnings/${STEP_NAME}/rules`);

    expect(res.ok(), `listing rules failed: ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    return (body.items ?? body.rules ?? body) as Rule[];
  }
});
