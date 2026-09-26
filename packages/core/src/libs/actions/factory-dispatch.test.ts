import { describe, expect, it } from 'vitest';
import { contractFromTask, contractGaps, deriveContract, factoryDispatchAction, pathsFromComponents, riskFromPaths } from './factory-dispatch';

// The engineering_task record as the worker's contract (snake_case), and what
// stops a task from being started. Every name and path below is invented.

const task = {
  id: 90,
  title: 'Add the request link dialog',
  meta: {
    repoSlug: 'Acme/northwind-core',
    objective: 'Add a Request a file button beside Upload.',
    acceptanceContract: [{ statement: 'A button sits beside Upload.' }, 'The dialog returns a link.'],
    allowedPaths: ['apps/web/src/**'],
    requiredChecks: ['typecheck', 'test'],
    riskClass: 'ui',
    requestId: 132,
    tokenBudget: 8,
  },
};

describe('the contract a dispatch sends', () => {
  it('maps the task into the worker schema, with the plan it was approved against', () => {
    const c = contractFromTask(task, { product: 'send', plan: { id: 134, approach: 'Surface what exists.', approvedBy: 'owner@example.test', approvedAt: '2026-09-26T00:00:00Z' } });

    expect(c).toMatchObject({
      task_id: 'send-t90',
      product: 'send',
      repo: 'https://github.com/Acme/northwind-core.git',
      base_sha: 'origin/main',
      acceptance_contract: ['A button sits beside Upload.', 'The dialog returns a link.'],
      allowed_paths: ['apps/web/src/**'],
      risk_class: 'ui',
      required_checks: ['typecheck', 'test'],
      request_id: '132',
      token_budget_usd: 8,
      plan: { plan_id: '134', approved_by: 'owner@example.test', summary: 'Surface what exists.' },
    });
  });

  it('names every missing field instead of sending a contract the worker would refuse', () => {
    expect(contractGaps(task.meta)).toEqual([]);
    expect(contractGaps({ objective: 'x' })).toEqual(['acceptanceContract', 'allowedPaths', 'requiredChecks', 'riskClass', 'repo']);
  });
});

describe('the input a card carries', () => {
  it('takes a task id, or the contract itself with the request it answers', () => {
    const contract = { title: 'Add the dialog', objective: 'Add it.', acceptanceContract: ['It is there.'], allowedPaths: ['apps/web/src/**'], requiredChecks: ['test'], riskClass: 'ui', repoSlug: 'Acme/northwind-core' };

    expect(factoryDispatchAction.inputSchema.safeParse({ taskId: 90 }).success).toBe(true);
    expect(factoryDispatchAction.inputSchema.safeParse({ requestId: 132, contract }).success).toBe(true);
    expect(factoryDispatchAction.inputSchema.safeParse({ requestId: 132, planId: 134 }).success).toBe(true);
    expect(factoryDispatchAction.inputSchema.safeParse({ requestId: 132, contract: { allowedPaths: 'apps/web/src/**, packages/api/src/**' } }).success).toBe(true);
    expect(factoryDispatchAction.inputSchema.safeParse({ contract }).success).toBe(false);
    expect(factoryDispatchAction.inputSchema.safeParse({}).success).toBe(false);
  });
});

describe('a contract from the records alone', () => {
  const request = { title: 'Request a file', outcome: 'Send a link to upload a file to you.', acceptance: [{ statement: 'A button sits beside Upload.' }] };
  const plan = { approach: 'Surface what exists.', repoSlugs: ['Acme/northwind-core'], components: ['apps/web — a button beside Upload', 'apps/web/src/components/RequestDialog.tsx (new) — the dialog', 'packages/api/src/routes/links.ts — close endpoint', 'expiry enforcement — a check on read'] };
  const repo = { title: 'Acme/northwind-core', checks: [{ name: 'typecheck' }, { name: 'test' }], riskDefaults: { 'apps/web/**': 'ui', 'packages/api/**': 'logic' } };

  it('fills every field the worker needs from the request, the plan and the repo', () => {
    const c = deriveContract({ given: {}, request, plan, repo });

    expect(c).toMatchObject({
      title: 'Request a file',
      objective: 'Send a link to upload a file to you. Surface what exists.',
      acceptanceContract: ['A button sits beside Upload.'],
      allowedPaths: ['apps/web/**', 'apps/web/src/components/RequestDialog.tsx', 'packages/api/src/routes/links.ts'],
      requiredChecks: ['typecheck', 'test'],
      riskClass: 'logic',
      repoSlug: 'Acme/northwind-core',
    });
    expect(contractGaps(c)).toEqual([]);
  });

  it('keeps what the card carried, and ignores a risk class the worker would refuse', () => {
    const c = deriveContract({ given: { allowedPaths: ['apps/web/src/**'], riskClass: 'standard' }, request, plan, repo });

    expect(c.allowedPaths).toEqual(['apps/web/src/**']);
    expect(c.riskClass).toBe('ui');
  });

  it('reads paths and risk the way a person wrote them', () => {
    expect(pathsFromComponents(['not a path — prose'])).toEqual([]);
    expect(riskFromPaths(['docs/x.md'], { 'apps/**': 'ui' })).toBeNull();
  });
});

describe('what a card carries that is not real', () => {
  it('drops prose paths and checks the repo does not define, and uses the records instead', () => {
    const c = deriveContract({
      given: { allowedPaths: ['send-web: header, RequestDialog.tsx'], requiredChecks: ['All six acceptance criteria pass'] },
      request: { title: 'R', outcome: 'o', acceptance: ['a'] },
      plan: { repoSlugs: ['Acme/northwind-core'], components: ['apps/web — a button'] },
      repo: { title: 'Acme/northwind-core', checks: [{ name: 'typecheck' }, { name: 'test' }] },
    });

    expect(c.allowedPaths).toEqual(['apps/web/**']);
    expect(c.requiredChecks).toEqual(['typecheck', 'test']);
  });
});
