/**
 * The factory's hand-offs are registered actions: `propose_action` accepts
 * them, each carries the shared hand-off input, the merge keys its trust rule
 * on `git.merge.<riskClass>`, and the card shows the recipe as written and the
 * evidence as links. No database — the registry and the builder alone.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { awsMutateAction, factoryActions, gitMergeAction, gitPushBranchAction, MERGE_RISK_CLASSES, notifyRequesterAction, verdictLine } from './factory';
import { costLabel, isManualAction, looksLikeManualInput, manualAction, manualInputSchema } from './manual';
import { policyKeyForRun } from './policyKey';
import { getAction, listActions } from './registry';

const RECIPE = 'git fetch origin\ngit checkout main\ngit merge --no-ff origin/feat/factory-actions\ngit push origin main';

const base = {
  title: 'Merge #484: hand-off actions',
  summary: 'Reviewed on the PR; CI green; the plugin trust rules bind to registered ids after this.',
  recipe: RECIPE,
  evidence: ['https://github.com/vocion/vocion-core/pull/484', 'ci:run/9182'],
  externalRef: { system: 'github', id: 'vocion/vocion-core#484', url: 'https://github.com/vocion/vocion-core/pull/484' },
  commitSha: 'a1b2c3d4e5f6',
  rollback: 'revert the merge commit and redeploy; no data written',
};

describe('the factory hand-offs are registered', () => {
  it('registers every id the factory trust file names, and the two the task adds', () => {
    const ids = listActions().map(a => a.id);
    for (const id of ['git.push_branch', 'git.merge', 'deploy.release', 'deploy.provision', 'aws.mutate', 'credentials.write', 'release.announce', 'notify.requester']) {
      expect(ids, id).toContain(id);
    }

    expect(factoryActions).toHaveLength(8);
  });

  it('every one is a hand-off, external, and irreversible except the push', () => {
    for (const a of factoryActions) {
      expect(isManualAction(a), a.id).toBe(true);
      expect(a.external, a.id).toBe(true);
      expect(a.undo, a.id).toBeUndefined();
      expect(a.manual?.reversible ?? false, a.id).toBe(a.id === 'git.push_branch');
    }

    expect(gitPushBranchAction.manual).toEqual({ reversible: true });
  });

  it('the shared input needs a title, a summary and the steps in one form or the other; the merge needs a risk class too', () => {
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y', recipe: 'terraform apply' }).success).toBe(true);
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y', steps: [{ say: 'Apply the plan', run: 'terraform apply' }] }).success).toBe(true);

    // Neither: refused, and the refusal names what to send.
    const neither = getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y' });

    expect(neither.success).toBe(false);
    expect(JSON.stringify(neither.success ? null : neither.error.issues)).toMatch(/steps.*recipe/);
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y', recipe: 'z', externalRef: { system: 'aws' } }).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse(base).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse({ ...base, riskClass: 'docs' }).success).toBe(true);

    // A merge that is a deploy names its commit and its way back, or it is not filed (review, 2026-09-24).
    const { commitSha: _c, ...noCommit } = base;
    const { rollback: _r, ...noRollback } = base;

    expect(gitMergeAction.inputSchema.safeParse({ ...noCommit, riskClass: 'docs' }).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse({ ...noRollback, riskClass: 'docs' }).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse({ ...base, riskClass: 'everything' }).success).toBe(false);
  });

  it('one merge id serves ten ledgers: the policy key is git.merge.<riskClass>', () => {
    for (const cls of MERGE_RISK_CLASSES) {
      expect(policyKeyForRun('git.merge', { ...base, riskClass: cls })).toBe(`git.merge.${cls}`);
    }

    // A kind with no derived key, or an unregistered id, keys on itself.
    expect(policyKeyForRun('deploy.provision', base)).toBe('deploy.provision');
    expect(policyKeyForRun('nope.unknown', {})).toBe('nope.unknown');
    // A malformed payload never throws its way out of the gate.
    expect(policyKeyForRun('git.merge', {})).toBe('git.merge.undefined');
  });

  it('binds the merge card to its commit and says when QA\'s verdict is about a different one', async () => {
    const same = await gitMergeAction.reviewCard!({ orgId: 'org_x' }, { ...base, riskClass: 'ui', verdictCommitSha: 'a1b2c3d' });
    const moved = await gitMergeAction.reviewCard!({ orgId: 'org_x' }, { ...base, riskClass: 'ui', verdictCommitSha: '0000000' });
    const none = await gitMergeAction.reviewCard!({ orgId: 'org_x' }, { ...base, riskClass: 'ui' });

    expect(same.fields).toEqual(expect.arrayContaining([
      { label: 'Commit', value: 'a1b2c3d4e5f6' },
      { label: 'QA verdict', value: 'read at a1b2c3d — this commit' },
      { label: 'If the health check fails', value: base.rollback },
    ]));
    expect(moved.fields.find(f => f.label === 'QA verdict')?.value).toMatch(/^STALE — read at 0000000, the branch has moved to a1b2c3d/);
    expect(none.fields.find(f => f.label === 'QA verdict')?.value).toMatch(/not bound to a commit/);
    expect(verdictLine('abcdef1234', 'abcdef1')).toBe('read at abcdef1 — this commit');
  });

  it('a reply is two ledgers: a routine completion may earn its way, everything else is a person\'s', () => {
    expect(notifyRequesterAction.inputSchema.safeParse({ ...base, kind: 'completion' }).success).toBe(true);
    expect(notifyRequesterAction.inputSchema.safeParse({ ...base }).success).toBe(false);
    expect(policyKeyForRun('notify.requester', { ...base, kind: 'completion' })).toBe('notify.requester.completion');

    for (const kind of ['decline', 'incident', 'question']) {
      expect(policyKeyForRun('notify.requester', { ...base, kind })).toBe('notify.requester.sensitive');
    }
  });

  it('dedups on the external record when there is one, and not at all when there is none', () => {
    expect(gitMergeAction.dedupKeyFor!({ ...base, riskClass: 'docs' })).toBe('git.merge:github:vocion/vocion-core#484');
    expect(gitMergeAction.dedupKeyFor!({ title: 'a', summary: 'b', recipe: 'c', riskClass: 'docs' })).toBeUndefined();
  });

  it('the card carries the recipe as a preformatted text item, URLs as links, refs as rows', async () => {
    const card = await gitMergeAction.reviewCard!({ orgId: 'org_x' }, { ...base, riskClass: 'schema' });

    expect(card.title).toBe(base.title);
    expect(card.system).toBe('Git');
    expect(card.summary).toBe(base.summary);
    expect(card.content).toEqual([{ kind: 'text', id: 'recipe', label: 'Recipe', body: RECIPE, preformatted: true }]);
    expect(card.links).toEqual([{ label: 'github.com/vocion/vocion-core/pull/484', href: 'https://github.com/vocion/vocion-core/pull/484' }]);
    expect(card.fields).toEqual(expect.arrayContaining([
      { label: 'Risk class', value: 'schema' },
      { label: 'Record', value: 'github vocion/vocion-core#484', href: 'https://github.com/vocion/vocion-core/pull/484' },
      { label: 'Evidence', value: 'ci:run/9182' },
    ]));
    // "Can be put back" is a badge now, not a row three tabs away.
    expect(card.fields.map(f => f.label)).not.toContain('Can be put back');
    expect(card.verbs).toEqual({ approve: 'Approve', reject: 'Reject' });
    expect(card.nextAction).toMatch(/Nothing runs here/);
  });

  it('the card leads with one sentence and the badges that settle it: system, Irreversible, cost, target', async () => {
    const card = await gitMergeAction.reviewCard!({ orgId: 'org_x' }, { ...base, riskClass: 'schema' });

    // No headline written: the first sentence of the summary stands in.
    expect(card.headline).toBe('Reviewed on the PR; CI green; the plugin trust rules bind to registered ids after this.');
    expect(card.badges).toEqual([
      { label: 'Git' },
      { label: 'Irreversible', tone: 'warn' },
      { label: 'No cost' },
    ]);
    expect(card.handoff).toEqual({ reversible: false });
    // The middle crumb names the queue for what a person does there.
    expect(card.object).toEqual({ title: base.title, section: 'Approvals' });

    const push = await gitPushBranchAction.reviewCard!({ orgId: 'org_x' }, { ...base, headline: 'Push the branch so the diff can be read.', cost: { amount: 14, currency: 'USD', period: 'year' }, target: 'AWS account acme-prod (123456789012)' });

    expect(push.headline).toBe('Push the branch so the diff can be read.');
    expect(push.badges).toEqual([
      { label: 'Git' },
      { label: 'Reversible' },
      { label: '$14/year' },
      { label: 'AWS account acme-prod (123456789012)' },
    ]);
    expect(push.handoff).toEqual({ reversible: true });
  });

  it('a headline is one sentence: 140 characters, no more', () => {
    expect(manualInputSchema.safeParse({ ...base, headline: 'x'.repeat(140) }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, headline: 'x'.repeat(141) }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, headline: '' }).success).toBe(false);
  });

  it('steps are ordered say / run? / url?, at most 30, each command at most 4000 characters', () => {
    const step = { say: 'Register the domain in the account', run: 'aws route53domains register-domain --domain-name kestrel-capital.example', url: 'https://console.aws.example/route53' };

    expect(manualInputSchema.safeParse({ ...base, steps: [step] }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, steps: [{ say: 'Open the console' }] }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, steps: [] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, steps: [{ run: 'ls' }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, steps: [{ say: 'x'.repeat(301) }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, steps: [{ say: 'ok', run: 'x'.repeat(4_001) }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, steps: [{ say: 'ok', url: 'not a url' }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, steps: Array.from({ length: 30 }, () => step) }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, steps: Array.from({ length: 31 }, () => step) }).success).toBe(false);
  });

  it('cost is a non-negative USD amount with an optional period; target is a line; sources are labelled URLs', () => {
    expect(manualInputSchema.safeParse({ ...base, cost: { amount: 14, currency: 'USD', period: 'year' } }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, cost: { amount: 0, currency: 'USD' } }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, cost: { amount: -1, currency: 'USD' } }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, cost: { amount: 14, currency: 'EUR' } }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, cost: { amount: 14, currency: 'USD', period: 'week' } }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, target: 'AWS account acme-prod (123456789012)' }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, target: '' }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, sources: [{ label: 'Route 53 pricing', url: 'https://aws.example/route53/pricing' }] }).success).toBe(true);
    expect(manualInputSchema.safeParse({ ...base, sources: [{ label: 'Route 53 pricing' }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, sources: [{ url: 'https://aws.example/route53/pricing' }] }).success).toBe(false);
    expect(manualInputSchema.safeParse({ ...base, sources: [{ label: 'x', url: 'nope' }] }).success).toBe(false);

    expect(costLabel(undefined)).toBe('No cost');
    expect(costLabel({ amount: 14, currency: 'USD' })).toBe('$14');
    expect(costLabel({ amount: 14, currency: 'USD', period: 'once' })).toBe('$14');
    expect(costLabel({ amount: 3.5, currency: 'USD', period: 'month' })).toBe('$3.50/month');
  });

  it('structured steps render as a steps item; the recipe block is the fallback; named sources link first', async () => {
    const steps = [
      { say: 'Register the domain in the account.', run: 'aws route53domains register-domain --domain-name kestrel-capital.example --duration-in-years 1', url: 'https://console.aws.example/route53' },
      { say: 'Wait for the registration email and confirm it.' },
    ];
    const card = await awsMutateAction.reviewCard!({ orgId: 'org_x' }, {
      title: 'Register kestrel-capital.example in Route 53',
      summary: 'The rename needs the domain before the marketing site can move. Nothing else depends on it yet.',
      steps,
      cost: { amount: 14, currency: 'USD', period: 'year' },
      target: 'AWS account acme-prod (123456789012)',
      sources: [{ label: 'Route 53 pricing', url: 'https://aws.example/route53/pricing' }],
      evidence: ['https://aws.example/route53/pricing', 'https://github.com/acme/site/issues/12', 'task:17'],
    });

    expect(card.content).toEqual([{ kind: 'steps', id: 'recipe', label: 'Recipe', steps }]);
    expect(card.headline).toBe('The rename needs the domain before the marketing site can move.');
    // The labelled source first; the evidence URL it already names is not
    // repeated; the other evidence URL follows; the ref stays a row.
    expect(card.links).toEqual([
      { label: 'Route 53 pricing', href: 'https://aws.example/route53/pricing' },
      { label: 'github.com/acme/site/issues/12', href: 'https://github.com/acme/site/issues/12' },
    ]);
    expect(card.fields).toEqual([{ label: 'Evidence', value: 'task:17' }]);
  });

  it('a hand-off\'s execute refuses — it is never the path a release takes', async () => {
    await expect(getAction('credentials.write')!.execute({ orgId: 'org_x' }, base)).rejects.toThrow(/hand-off/);
  });

  it('the pure describers can recognise the shape without the registry', () => {
    expect(looksLikeManualInput(base)).toBe(true);
    // Steps alone are the shape too.
    expect(looksLikeManualInput({ title: 'a', summary: 'b', steps: [{ say: 'c' }] })).toBe(true);
    expect(looksLikeManualInput({ title: 'a', summary: 'b', steps: [] })).toBe(false);
    expect(looksLikeManualInput({ objectType: 'deals', properties: {} })).toBe(false);
    expect(looksLikeManualInput(null)).toBe(false);
  });

  it('the builder is generic: a new hand-off is a descriptor, with its own extra field and key', async () => {
    const a = manualAction({
      id: 'test.handoff',
      name: 'Test hand-off',
      description: 'test',
      system: 'Test',
      grant: 'test_write',
      extend: { lane: z.enum(['a', 'b']) },
      extraFields: input => [{ label: 'Lane', value: input.lane }],
      policyKeyFor: input => `test.handoff.${input.lane}`,
    });

    expect(a.manual).toEqual({ reversible: false });
    expect(a.inputSchema.safeParse({ ...base, lane: 'b' }).success).toBe(true);
    expect(a.policyKeyFor!({ ...base, lane: 'b' })).toBe('test.handoff.b');
    expect((await a.reviewCard!({ orgId: 'o' }, { ...base, lane: 'b' })).fields[0]).toEqual({ label: 'Lane', value: 'b' });
  });
});
