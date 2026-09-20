/**
 * The factory's hand-offs are registered actions: `propose_action` accepts
 * them, each carries the shared hand-off input, the merge keys its trust rule
 * on `git.merge.<riskClass>`, and the card shows the recipe as written and the
 * evidence as links. No database — the registry and the builder alone.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { factoryActions, gitMergeAction, gitPushBranchAction, MERGE_RISK_CLASSES } from './factory';
import { isManualAction, looksLikeManualInput, manualAction } from './manual';
import { policyKeyForRun } from './policyKey';
import { getAction, listActions } from './registry';

const RECIPE = 'git fetch origin\ngit checkout main\ngit merge --no-ff origin/feat/factory-actions\ngit push origin main';

const base = {
  title: 'Merge #484: hand-off actions',
  summary: 'Reviewed on the PR; CI green; the plugin trust rules bind to registered ids after this.',
  recipe: RECIPE,
  evidence: ['https://github.com/vocion/vocion-core/pull/484', 'ci:run/9182'],
  externalRef: { system: 'github', id: 'vocion/vocion-core#484', url: 'https://github.com/vocion/vocion-core/pull/484' },
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

  it('the shared input needs a title, a summary and a recipe; the merge needs a risk class too', () => {
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y', recipe: 'terraform apply' }).success).toBe(true);
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y' }).success).toBe(false);
    expect(getAction('deploy.provision')!.inputSchema.safeParse({ title: 'x', summary: 'y', recipe: 'z', externalRef: { system: 'aws' } }).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse(base).success).toBe(false);
    expect(gitMergeAction.inputSchema.safeParse({ ...base, riskClass: 'docs' }).success).toBe(true);
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
      { label: 'Can be put back', value: 'no' },
    ]));
    expect(card.verbs).toEqual({ approve: 'Release', reject: 'Decline' });
    expect(card.nextAction).toMatch(/Nothing runs here/);
  });

  it('a hand-off\'s execute refuses — it is never the path a release takes', async () => {
    await expect(getAction('credentials.write')!.execute({ orgId: 'org_x' }, base)).rejects.toThrow(/hand-off/);
  });

  it('the pure describers can recognise the shape without the registry', () => {
    expect(looksLikeManualInput(base)).toBe(true);
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
