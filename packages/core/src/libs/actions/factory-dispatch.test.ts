import { describe, expect, it } from 'vitest';
import { contractFromTask, contractGaps } from './factory-dispatch';

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
