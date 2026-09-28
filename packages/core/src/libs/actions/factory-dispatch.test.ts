import { describe, expect, it } from 'vitest';
import { contractFromTask, contractGaps, deriveContract, factoryDispatchAction, fitName, pathsFromComponents, riskFromPaths } from './factory-dispatch';

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
  } as Record<string, unknown>,
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
    expect(contractGaps({ ...task.meta, qa: { flows: [{ name: 'x', path: '/' }] } })).toEqual([]);
    expect(contractGaps({ objective: 'x' })).toEqual(['acceptanceContract', 'allowedPaths', 'requiredChecks', 'riskClass', 'repo']);
    expect(contractGaps({ ...task.meta })).toEqual(['qa.flows (a ui change is screenshotted before and after)']);
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

  it('carries the last attempt\'s verdict into the objective: what QA could not prove is this attempt\'s brief', () => {
    const previous = { id: 157, meta: { prUrl: 'https://github.com/Acme/northwind-core/pull/50', verdict: { note: 'No screenshot of the dialog.', criteria: [
      { criterion: 'A button sits beside Upload.', status: 'proven', evidence: 'shot 1' },
      { criterion: 'The dialog names the file types.', status: 'unproven', evidence: 'no screenshot of the open dialog' },
      { criterion: 'Closing a request stops uploads.', status: 'unchecked' },
    ] } } };
    const c = deriveContract({ given: {}, request, plan, repo, previous });

    expect(c.previousTaskId).toBe(157);
    expect(String(c.objective).split('\n')).toEqual([
      'Send a link to upload a file to you. Surface what exists.',
      '',
      'The last attempt (task #157, https://github.com/Acme/northwind-core/pull/50) was sent back by QA: No screenshot of the dialog.',
      'Prove each of these with evidence a reviewer can open (a named test, a screenshot of that exact state):',
      '- The dialog names the file types. (QA: no screenshot of the open dialog)',
      '- Closing a request stops uploads.',
    ]);
  });

  it('builds a request with no plan from the paths the repo gives its product (#201: a P1 bug filed without a plan)', () => {
    const withProduct = { ...repo, productPaths: { northwind: ['apps/web/**', 'packages/api/**', 'not a path'] } };
    const c = deriveContract({ given: {}, request: { ...request, product: 'northwind' }, plan: null, repo: withProduct });

    expect(c.allowedPaths).toEqual(['apps/web/**', 'packages/api/**', 'apps/web/tests/**', 'packages/api/tests/**']);
    expect(c.requiredChecks).toEqual(['typecheck', 'test']);
    expect(c.repoSlug).toBe('Acme/northwind-core');
    expect(contractGaps(c)).toEqual([]);
  });

  it('takes the paths for the request\'s surface before the whole product (#201: an api-only bug refused for spanning two packages)', () => {
    const withSurface = { ...repo, productPaths: { 'northwind': ['apps/web/**', 'packages/api/**'], 'northwind.data': ['packages/api/**'] } };
    const c = deriveContract({ given: {}, request: { ...request, product: 'northwind', surface: 'data' }, plan: null, repo: withSurface });

    expect(c.allowedPaths).toEqual(['packages/api/**', 'packages/api/tests/**']);
  });

  it('opens a ui app\'s src/** when the plan names only a file in it (#126: a visible criterion needs its component)', () => {
    const libOnly = { ...plan, components: ['apps/web/src/lib/upload.ts — multipart with retry', 'packages/api/src/routes/links.ts — part signing'] };
    const c = deriveContract({ given: {}, request, plan: libOnly, repo });

    expect(c.allowedPaths).toEqual(['apps/web/src/lib/upload.ts', 'packages/api/src/routes/links.ts', 'apps/web/src/**', 'apps/web/tests/**', 'packages/api/tests/**']);
  });

  it('files the riskiest class a path touches, infra included (#126 attempt 195)', () => {
    const withInfra = { ...repo, riskDefaults: { ...repo.riskDefaults, 'packages/infra/**': 'infra' } };
    const c = deriveContract({ given: {}, request, plan: { ...plan, components: ['packages/api/src/routes/links.ts — signing', 'packages/infra/scripts/ecr-deploy.js — lifecycle'] }, repo: withInfra });

    expect(c.riskClass).toBe('infra');
  });

  it('brings a generated file\'s source, and its risk class, into the contract (#124: prisma schema)', () => {
    const withGen = { ...repo, generatedFrom: { 'packages/api/prisma/schema/**': 'packages/core/prisma/**' }, riskDefaults: { ...repo.riskDefaults, 'packages/core/prisma/**': 'schema' } };
    const c = deriveContract({ given: {}, request, plan: { ...plan, components: ['packages/api/prisma/schema/core.prisma — AlertLog table'] }, repo: withGen });

    expect(c.allowedPaths).toContain('packages/core/prisma/**');
    expect(c.riskClass).toBe('schema');

    const withMigrations = { ...withGen, generatedFrom: { 'packages/api/prisma/schema/**': ['packages/core/prisma/**', 'packages/api/prisma/schema/migrations/**'] } };
    const m = deriveContract({ given: {}, request, plan: { ...plan, components: ['packages/api/prisma/schema/core.prisma — AlertLog table'] }, repo: withMigrations });

    expect(m.allowedPaths).toEqual(expect.arrayContaining(['packages/core/prisma/**', 'packages/api/prisma/schema/migrations/**']));
  });

  it('says a held merge came from the person who merges, in their words (2026-09-28)', () => {
    const previous = { id: 190, meta: { prUrl: 'https://github.com/Acme/northwind-core/pull/89', verdict: { value: 'changes', heldBy: 'person', note: 'A person held the merge: the cleanup rule is not applied in production.', criteria: [{ criterion: 'A button sits beside Upload.', status: 'proven' }] } } };
    const c = deriveContract({ given: {}, request, plan, repo, previous });

    expect(String(c.objective)).toContain('was sent back by the person who merges: the cleanup rule is not applied in production.');
  });

  it('fills every field the worker needs from the request, the plan and the repo', () => {
    const c = deriveContract({ given: {}, request, plan, repo });

    expect(c).toMatchObject({
      title: 'Request a file',
      objective: 'Send a link to upload a file to you. Surface what exists.',
      acceptanceContract: ['A button sits beside Upload.'],
      allowedPaths: ['apps/web/**', 'apps/web/src/components/RequestDialog.tsx', 'packages/api/src/routes/links.ts', 'apps/web/tests/**', 'packages/api/tests/**'],
      requiredChecks: ['typecheck', 'test'],
      riskClass: 'logic',
      repoSlug: 'Acme/northwind-core',
    });
    expect(contractGaps(c)).toEqual([]);
  });

  it('keeps what the card carried, and ignores a risk class the worker would refuse', () => {
    const c = deriveContract({ given: { allowedPaths: ['apps/web/src/**'], riskClass: 'standard' }, request, plan, repo });

    expect(c.allowedPaths).toEqual(['apps/web/src/**', 'apps/web/tests/**']);
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

    expect(c.allowedPaths).toEqual(['apps/web/**', 'apps/web/tests/**']);
    expect(c.requiredChecks).toEqual(['typecheck', 'test']);
  });
});

describe('what a ui change carries', () => {
  it('gets a QA flow at the page the request lives on, and the repo\'s environment', () => {
    const c = deriveContract({
      given: {},
      request: { title: 'Find a document', outcome: 'o', acceptance: ['a'], visuals: { surfaceUrl: 'https://app.example.test/library' } },
      plan: { repoSlugs: ['Acme/northwind-core'], components: ['apps/web — search'] },
      repo: { title: 'Acme/northwind-core', checks: [{ name: 'test' }], riskDefaults: { 'apps/web/**': 'ui' }, environment: { services: ['postgres'] } },
    });

    expect(c.qa).toEqual({ surface: 'app', flows: [{ name: 'Find a document', path: '/library', sign_in: true }] });
    expect(c.environment).toEqual({ services: ['postgres'] });
    expect(contractGaps(c)).toEqual([]);
  });
});

describe('a plan\'s risks', () => {
  it('become acceptance lines, at most two', () => {
    const c = deriveContract({
      given: {},
      request: { title: 'R', outcome: 'o', acceptance: ['a'] },
      plan: { risks: ['Abuse: add a per-link rate limit', 'Confusion: one line in the dialog', 'Third'], repoSlugs: ['Acme/x'], components: ['apps/web — b'] },
      repo: { title: 'Acme/x', checks: [{ name: 'test' }] },
    });

    expect(c.acceptanceContract).toEqual(['a', 'The plan\'s risk is handled: Abuse: add a per-link rate limit', 'The plan\'s risk is handled: Confusion: one line in the dialog']);
  });
});

describe('a visible change on a logic contract', () => {
  it('still gets a QA flow when the request\'s surface is ui', () => {
    const c = deriveContract({
      given: {},
      request: { title: 'Search', outcome: 'o', acceptance: ['a'], surface: 'ui', visuals: { surfaceUrl: 'https://app.example.test/' } },
      plan: { repoSlugs: ['Acme/x'], components: ['packages/api/src/routes/documents.ts — q param'] },
      repo: { title: 'Acme/x', checks: [{ name: 'test' }], riskDefaults: { 'packages/api/**': 'logic' } },
    });

    expect(c.riskClass).toBe('logic');
    expect(c.qa).toEqual({ surface: 'app', flows: [{ name: 'Search', path: '/', sign_in: true }] });
  });
});

describe('a retry is its own trust key', () => {
  it('keys a retry on factory.dispatch_task.retry and a first build on the action id, and never collapses the two', () => {
    expect(factoryDispatchAction.policyKeyFor?.({ requestId: 131, reason: 'x', autoRetryOf: 164 } as never)).toBe('factory.dispatch_task.retry');
    expect(factoryDispatchAction.policyKeyFor?.({ requestId: 131, reason: 'x' } as never)).toBe('factory.dispatch_task');
    expect(factoryDispatchAction.dedupKeyFor?.({ requestId: 131, reason: 'x', autoRetryOf: 164 } as never)).toBe('factory.dispatch_task:request-131:retry-164');
  });
});

describe('the factory\'s own starts are their own trust keys (backlog 038)', () => {
  it('keys each automatic start apart, and one recovery per failed run', () => {
    expect(factoryDispatchAction.policyKeyFor?.({ requestId: 131, reason: 'x', trigger: 'request' } as never)).toBe('factory.dispatch_task.from_request');
    expect(factoryDispatchAction.policyKeyFor?.({ requestId: 131, reason: 'x', trigger: 'recovery', recoveryOfRun: 401 } as never)).toBe('factory.dispatch_task.recovery');
    expect(factoryDispatchAction.policyKeyFor?.({ requestId: 131, reason: 'x', trigger: 'plan', planId: 9 } as never)).toBe('factory.dispatch_task.from_plan');
    expect(factoryDispatchAction.dedupKeyFor?.({ requestId: 131, reason: 'x', trigger: 'recovery', recoveryOfRun: 401 } as never)).toBe('factory.dispatch_task:request-131:recovery-401');
    expect(factoryDispatchAction.dedupKeyFor?.({ requestId: 131, reason: 'x', trigger: 'plan', planId: 9 } as never)).toBe('factory.dispatch_task:request-131:plan-9');
    expect(factoryDispatchAction.dedupKeyFor?.({ requestId: 131, reason: 'x', trigger: 'request' } as never)).toBe('factory.dispatch_task:request-131:from-request');
    expect(factoryDispatchAction.inputSchema.safeParse({ requestId: 131, trigger: 'someone' }).success).toBe(false);
  });

  it('carries a note — the person\'s, or the failing checks\' — into the objective', () => {
    const c = deriveContract({ given: {}, request: { title: 'Request a file', outcome: 'Send a link.' }, plan: null, repo: null, note: 'Make the test pass: expected 2, got 3.' });

    expect(String(c.objective)).toBe('Send a link.\n\nFor this attempt: Make the test pass: expected 2, got 3.');
  });
});

describe('a QA flow name fits the worker\'s contract (#214: a 64-character title refused run 404)', () => {
  it('keeps a short title, and cuts a long one at a whole word within 60 characters', () => {
    expect(fitName('Find a document', 60)).toBe('Find a document');

    const long = fitName('Download CSV of document viewers from the "Who opened it" panel', 60);

    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toBe('Download CSV of document viewers from the "Who opened it…');
  });

  it('names the derived flow within the limit', () => {
    const c = deriveContract({ given: {}, request: { title: 'Download CSV of document viewers from the "Who opened it" panel', surface: 'ui', acceptance: [{ statement: 'A button.' }] }, plan: null, repo: { title: 'Acme/northwind-core', riskDefaults: {} } });
    const flows = (c.qa as { flows: Array<{ name: string }> }).flows;

    expect(flows[0]!.name.length).toBeLessThanOrEqual(60);
  });
});
