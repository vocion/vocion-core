import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, toolCallSchema } = await import('@/models/Schema');
const { citedTestsRefusal, latestTestRun, unopenedShots, unreadTestRun } = await import('./recordVerdict');

const ORG = 'org_opened';
const ctx = (missionRunId?: number) => ({ orgId: ORG, missionRunId } as never);

beforeEach(async () => {
  await db.delete(artifactSchema);
  await db.delete(toolCallSchema);
});

describe('unopenedShots', () => {
  it('refuses a verdict on a task with screenshots when this review opened none, and hands over every link', async () => {
    await db.insert(artifactSchema).values([
      { orgId: ORG, kind: 'file', title: 'Empty state · desktop · after', url: 'https://files.example/a.png', recordType: 'object', recordId: '176', recordRole: 'qa-screenshot', spec: {} },
      { orgId: ORG, kind: 'file', title: 'Chips · desktop · after', url: 'https://files.example/b.png', recordType: 'object', recordId: '176', recordRole: 'qa-screenshot', spec: {} },
    ] as never);
    const refusal = await unopenedShots(ctx(900), 176);

    expect(refusal).toMatch(/^Not recorded: task #176 has 2 screenshots and this review opened none of them/);
    expect(refusal).toMatch(/Empty state · desktop · after: \S*\/dashboard\/artifacts\/\d+/);

    await db.insert(toolCallSchema).values({ orgId: ORG, missionRunId: 900, tool: 'fetch_image', input: {}, output: 'Image fetched and verified: image/png, 1100×688', agentSlug: 'change-reviewer' } as never);

    expect(await unopenedShots(ctx(900), 176)).toBeNull();
  });

  it('asks nothing of a task with no screenshots, or of a call outside a review run', async () => {
    expect(await unopenedShots(ctx(900), 999)).toBeNull();
    expect(await unopenedShots(ctx(undefined), 176)).toBeNull();
  });
});

describe('unreadTestRun', () => {
  it('refuses the first verdict once with the stored test output and link, then lets the next call through (#131 attempts 185, 187)', async () => {
    await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Named tests, run 386', recordType: 'object', recordId: '185', recordRole: 'qa-test-run', spec: { md: '# Named tests, run 386\n\n## Passed: Scope holds\n\n✓ never returns a teammate kept-back document' } } as never);
    const run = { orgId: ORG, missionRunId: 901 } as { orgId: string; missionRunId: number; testRunShown?: boolean };

    const refusal = await unreadTestRun(run as never, 185);

    expect(refusal).toMatch(/^Not recorded: task #185 has a stored run of its named tests, and this verdict was written without reading it/);
    expect(refusal).toMatch(/✓ never returns a teammate kept-back document/);
    expect(refusal).toMatch(/\/dashboard\/artifacts\/\d+/);
    expect(await unreadTestRun(run as never, 185)).toBeNull();
    expect(await unreadTestRun({ orgId: ORG } as never, 999)).toBeNull();
  });
});

// Walk 10 (2026-10-02, FE-381 task 383): QA judged criteria on test names that matched nothing
// that ran. The worker now stores every test that ran (`spec.tests`); QA cites from that list.
describe('cite what ran', () => {
  const tests = [
    { id: 't1', file: 'apps/web/tests/lib/header.test.ts', name: 'the header > no stray dot (\'doc_q3\' at 375 px)', status: 'passed' },
    { id: 't2', file: 'apps/web/tests/lib/header.test.ts', name: 'the header > no stray dot (\'doc_a\' at 1280 px)', status: 'passed' },
    { id: 't3', file: 'apps/web/tests/lib/header.test.ts', name: 'the header > breaks', status: 'failed' },
  ];

  it('hands over the list of every test that ran with the stored output, and reads it back', async () => {
    await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Named tests, run 483', recordType: 'object', recordId: '383', recordRole: 'qa-test-run', spec: { md: '# Named tests, run 483\n\n## Passed: No stray dot', tests } } as never);

    const run = await latestTestRun(ORG, 383);

    expect(run?.tests.map(t => t.id)).toEqual(['t1', 't2', 't3']);

    const refusal = await unreadTestRun({ orgId: ORG, missionRunId: 902 } as never, 383);

    expect(refusal).toMatch(/with the tests that prove it by id/);
    expect(refusal).toMatch(/Every test that ran on the branch; cite these by id in a criterion's `tests`:\n- t1 passed: apps\/web\/tests\/lib\/header\.test\.ts › the header > no stray dot/);
  });

  it('refuses a cited test that did not run, with the list; refuses proven on a test that did not pass; accepts ids and full names that ran', () => {
    const run = { id: 2736, tests };
    const unknown = citedTestsRefusal([{ criterion: 'Header order', status: 'unproven', tests: ['the type sits before the page count ($document at $width px)'] }], run);

    expect(unknown).toMatch(/^Not recorded: "Header order" cites the test "the type sits before the page count \(\$document at \$width px\)", which is not one of the tests that ran on this branch \(artifact #2736\)/);
    expect(unknown).toContain('- t2 passed: apps/web/tests/lib/header.test.ts › the header > no stray dot (\'doc_a\' at 1280 px)');
    expect(citedTestsRefusal([{ criterion: 'Breaks', status: 'proven', tests: ['t3'] }], run)).toMatch(/is marked proven on t3 .* which failed on this branch/);
    expect(citedTestsRefusal([{ criterion: 'No stray dot', status: 'proven', tests: ['t1', 'the header > no stray dot (\'doc_a\' at 1280 px)'] }], run)).toBeNull();
    expect(citedTestsRefusal([{ criterion: 'No stray dot', status: 'proven', evidence: 'https://x.example/a' }], run)).toBeNull();
    // No stored list is the pipeline's gap: the citations stand.
    expect(citedTestsRefusal([{ criterion: 'No stray dot', status: 'proven', tests: ['t1'] }], null)).toBeNull();
  });
});
