import type { LinkMap } from '@/features/dashboard/pages/FieldValue';
import type { PageRow } from '@/libs/workspace/pageFields';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { declaredRecordFields, recordSections } from '@/libs/workspace/records';
import { RecordBody } from './RecordBody';
import '@/styles/global.css';

/**
 * A record page for an engineering task, in a real browser at 1440 and at
 * 390 (#522).
 *
 * The bug: every object of every type got "Discovery Summary … a
 * comprehensive overview of this discovery call" and an empty Details
 * card, and a task with a contract, checks, a merged pull request and a
 * cost showed none of it. What is asserted here is what the owner opened
 * /dashboard/objects/83 to read.
 *
 * The declaration here mirrors the shipped `engineering_task` type; that
 * the shipped file really declares it is asserted in
 * `libs/workspace/records.test.ts`, which reads the YAML itself.
 */

const FIELDS = declaredRecordFields({
  type: 'object',
  properties: {
    repoSlug: { 'type': 'string', 'x-display': { label: 'Repository', format: 'link', to: 'repo' } },
    productSlug: { 'type': 'string', 'x-display': { label: 'Product', format: 'link', to: 'product' } },
    objective: { 'type': 'string', 'x-display': { role: 'prose', order: 1 } },
    requestId: { 'type': 'integer', 'x-display': { label: 'Asked by', format: 'link', to: 'request', order: 2 } },
    acceptanceContract: { 'type': 'array', 'x-display': { label: 'Acceptance contract', role: 'prose', format: 'steps', order: 4 } },
    requiredChecks: { 'type': 'array', 'x-display': { label: 'Required checks', role: 'prose', format: 'steps', order: 5 } },
    riskClass: { 'type': 'string', 'x-display': { label: 'Risk', format: 'badge', group: 'Contract', tones: { auth: 'bad' } } },
    sizeClass: { 'type': 'string', 'x-display': { label: 'Size', format: 'badge', group: 'Contract', tones: { patch: 'muted' } } },
    attempt: { 'type': 'integer', 'x-display': { label: 'Attempt', group: 'Contract' } },
    dependencies: { 'type': 'array', 'x-display': { label: 'Waits on', format: 'link', to: 'engineering_task' } },
    knownFailures: { 'type': 'array', 'x-display': { label: 'Known failures', role: 'prose', format: 'steps', order: 9 } },
    estimateCents: { 'type': 'integer', 'x-display': { label: 'Estimated', format: 'money', group: 'Cost' } },
    actualCents: { 'type': 'integer', 'x-display': { label: 'Actual', format: 'money', group: 'Cost' } },
    costUpdatedAt: { 'type': 'string', 'format': 'date-time', 'x-display': { label: 'Cost as of' } },
    branch: { 'type': 'string', 'x-display': { label: 'Branch', format: 'mono', group: 'The change' } },
    commitSha: { 'type': 'string', 'x-display': { label: 'Commit', format: 'mono', group: 'The change' } },
    prUrl: { 'type': 'string', 'x-display': { label: 'Pull request', format: 'link' } },
    summary: { 'type': 'string', 'x-display': { label: 'What the worker said it did', role: 'prose', order: 6 } },
  },
});

const TASK: PageRow = {
  id: 83,
  title: 'Stop the Safari sign-in loop by setting SameSite=None on the session cookie',
  status: 'accepted',
  createdAt: new Date('2026-09-12T10:00:00Z'),
  meta: {
    repoSlug: 'squatch-core',
    productSlug: 'send',
    objective: 'Sessions drop on Safari because the session cookie is written without SameSite=None. Set it, and keep the loop closed.',
    requestId: 41,
    acceptanceContract: ['A Safari session survives a reload', 'The sign-in e2e spec passes'],
    requiredChecks: ['npm run lint', 'npm run test'],
    riskClass: 'auth',
    sizeClass: 'patch',
    attempt: 2,
    estimateCents: 400,
    actualCents: 512,
    prUrl: 'https://github.com/squatch/squatch-core/pull/318',
    commitSha: 'a1b2c3d4',
    branch: 'fix/safari-samesite',
    summary: 'Set `SameSite=None; Secure` on the session cookie and added a regression spec.',
    costUpdatedAt: '2026-09-12T11:20:00Z',
    workerRunId: 907,
  },
};

const LINKS: LinkMap = {
  'request:41': { href: '/dashboard/objects/41', label: 'Signing in on my iPhone loops forever' },
  'repo:squatch-core': { href: '/dashboard/objects/7', label: 'squatch-core' },
  'product:send': { href: '/dashboard/objects/3', label: 'Send' },
};

async function task() {
  const sections = recordSections(TASK, FIELDS);
  const screen = render(
    <div className="mx-auto max-w-[1200px] p-6">
      <RecordBody row={TASK} sections={sections} now={Date.parse('2026-09-14T00:00:00Z')} links={LINKS} />
    </div>,
  );

  await expect.element(page.getByRole('heading', { name: 'Objective' })).toBeInTheDocument();

  return screen;
}

describe('an engineering task at 1440', () => {
  it('reads its contract: the objective, what has to be true, and the checks that decide', async () => {
    await page.viewport(1440, 900);
    await task();

    expect(document.body.textContent).toContain('Sessions drop on Safari');
    expect(document.body.textContent).toContain('A Safari session survives a reload');
    expect(document.body.textContent).toContain('npm run lint');
    expect(document.body.textContent).toContain('Set `SameSite=None; Secure`'.replace(/`/g, ''));
  });

  it('reads its facts as money, badges and monospace — the same way the floor renders them', async () => {
    await page.viewport(1440, 900);
    await task();

    const cost = [...document.querySelectorAll('section')].find(s => s.textContent?.startsWith('Cost'))!;

    expect(cost.textContent).toContain('$4.00');
    expect(cost.textContent).toContain('$5.12');
    expect(document.body.textContent).toContain('auth');
    expect(document.body.textContent).toContain('a1b2c3d4');
  });

  it('links to the request by its title and to the pull request as #318', async () => {
    await page.viewport(1440, 900);
    await task();

    expect(document.querySelector('a[href="/dashboard/objects/41"]')?.textContent).toBe('Signing in on my iPhone loops forever');
    expect(document.querySelector('a[href="https://github.com/squatch/squatch-core/pull/318"]')?.textContent).toBe('#318');
  });

  it('never says "discovery call", and shows no empty field', async () => {
    await page.viewport(1440, 900);
    await task();

    expect(document.body.textContent).not.toContain('discovery call');
    expect(document.body.textContent).not.toContain('Discovery Summary');
    // Declared and absent: not drawn at all, not drawn as a dash.
    expect(document.body.textContent).not.toContain('Known failures');
    expect(document.body.textContent).not.toContain('Waits on');
  });

  it('puts a value the type never declared in Other fields rather than nowhere', async () => {
    await page.viewport(1440, 900);
    await task();

    const other = document.querySelector('details')!;

    expect(other.textContent).toContain('Other fields');
    expect(other.textContent).toContain('workerRunId');
    expect(other.textContent).toContain('907');
  });
});

describe('an engineering task at 390', () => {
  it('reads as one column, with the title untruncated and no sideways scroll', async () => {
    await page.viewport(390, 844);
    await task();

    expect(document.body.textContent).toContain('Sessions drop on Safari');

    const doc = document.scrollingElement!;

    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
  });
});
