import { describe, expect, it } from 'vitest';
import {
  packageRoot,
  packageRoots,
  PLAN_DEFAULT_THRESHOLDS,
  PLAN_OFFERED_RISK_CLASSES,
  PLAN_REQUIRED_RISK_CLASSES,
  planRecordFromTask,
  planRequirement,
  planRequirementForTask,
  publicInterfaces,
  touchesMoreThanOneFile,
} from './planRule';

/**
 * The gating rule, case by case.
 *
 * This is the same rule the worker enforces in `factory/worker/plan.mjs` in
 * Meta-CTO/squatch-core, where a contract that needs a plan and carries none is
 * refused before the repository is cloned. The cases here are the cases there,
 * deliberately, so the two cannot drift without a test saying so.
 */

const codes = (subject: Parameters<typeof planRequirement>[0], context?: Parameters<typeof planRequirement>[1]) =>
  planRequirement(subject, context).triggers.map(t => t.code);

describe('what the rule leaves alone', () => {
  it('asks for no plan for docs, marketing or deps work on one surface', () => {
    for (const riskClass of ['docs', 'marketing', 'deps']) {
      expect(planRequirement({ riskClass, allowedPaths: ['docs/NOTE.md'] }).level).toBe('not_required');
    }
  });

  it('asks for no plan for a single file ui or logic change', () => {
    for (const riskClass of PLAN_OFFERED_RISK_CLASSES) {
      expect(planRequirement({ riskClass, allowedPaths: ['apps/web/src/Doc.tsx'] }).level).toBe('not_required');
    }
  });

  it('does not count prose as an architectural boundary', () => {
    expect(packageRoots(['docs/DECISIONS.md', 'docs/**', 'README.md', '.github/workflows/CI.yml'])).toEqual([]);
    expect(planRequirement({ riskClass: 'docs', allowedPaths: ['docs/A.md', 'docs/B.md', 'README.md'] }).level).toBe('not_required');
  });
});

describe('when the rule requires a plan', () => {
  it('requires one for every irreversible, trust bearing or promise risk class', () => {
    for (const riskClass of PLAN_REQUIRED_RISK_CLASSES) {
      const decision = planRequirement({ riskClass, allowedPaths: ['docs/NOTE.md'] });

      expect(decision.level).toBe('required');
      expect(decision.triggers.map(t => t.code)).toEqual(['risk_class']);
      expect(decision.triggers[0]!.why).toContain(`the risk class is ${riskClass}`);
    }
  });

  it('requires one when the request spans more than one repository', () => {
    expect(codes({ riskClass: 'ui', repo: 'squatch-core' }, { repos: ['squatch-core', 'vocion-core'] })).toEqual(['cross_repo']);
    expect(codes({ riskClass: 'docs', repo: 'squatch-core' }, { repos: ['Meta-CTO/squatch-core.git', 'squatch-core'] })).toEqual([]);
  });

  it('requires one when a dependency comes from another repository', () => {
    expect(codes({ riskClass: 'docs', repo: 'squatch-core', dependencies: ['vocion-core:VC-12'] })).toEqual(['cross_repo']);
    expect(codes({ riskClass: 'docs', repo: 'squatch-core', dependencies: ['squatch-core#T-9', 'T-8'] })).toEqual([]);
  });

  it('requires one when the allowed paths cross a package boundary', () => {
    const decision = planRequirement({ riskClass: 'ui', allowedPaths: ['apps/web/src/**', 'packages/core/src/x.ts'] });

    expect(decision.triggers.map(t => t.code)).toEqual(['package_span']);
    expect(decision.triggers[0]!.why).toContain('apps/web, packages/core');
    expect(codes({ riskClass: 'ui', allowedPaths: ['apps/web/src/**', 'apps/web/tests/**'] })).toEqual([]);
  });

  it('reads the package a glob belongs to, and says null when there is none', () => {
    expect(packageRoot('apps/send-web/src/**')).toBe('apps/send-web');
    expect(packageRoot('packages/core/src/services/notify.ts')).toBe('packages/core');
    expect(packageRoot('factory/intake/lib.mjs')).toBe('factory');
    expect(packageRoot('docs/DECISIONS.md')).toBeNull();
    expect(packageRoot('apps/**')).toBeNull();
    expect(packageRoot('README.md')).toBeNull();
  });

  it('requires one when the work reaches a public interface, and says which', () => {
    const cases: Array<[string, string]> = [
      ['packages/core/src/routes/orgs.ts', 'an HTTP route'],
      ['packages/core/migrations/**', 'a database migration'],
      ['plugins/software-factory/objects/request/type.yaml', 'an object type schema'],
      ['docs/SEND-API-CONTRACT.md', 'a published contract'],
    ];
    for (const [glob, what] of cases) {
      expect(publicInterfaces([glob])).toEqual([what]);
      expect(codes({ riskClass: 'ui', allowedPaths: [glob] })).toEqual(['public_interface']);
    }

    expect(publicInterfaces(['apps/web/src/Doc.tsx'])).toEqual([]);
  });

  it('names the declared database beside a migration, and never treats a service as a trigger of its own', () => {
    const withDb = planRequirement({ riskClass: 'ui', allowedPaths: ['apps/api/prisma/**'], services: ['postgres'] });

    expect(withDb.triggers[0]!.why).toContain('with a postgres service declared');
    expect(planRequirement({ riskClass: 'docs', allowedPaths: ['docs/A.md'], services: ['postgres'] }).level).toBe('not_required');
  });

  it('requires one when more than one engineering task sits under the request', () => {
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'] }, { taskCount: 2 })).toEqual(['task_count']);
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'] }, { taskCount: 1 })).toEqual([]);
  });

  it('requires one over the estimate threshold, and takes every threshold from configuration', () => {
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'], estimateUsd: 10 })).toEqual([]);
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'], estimateUsd: 10.5 })).toEqual(['estimate']);
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'], estimateUsd: 10.5 }, { thresholds: { estimateUsd: 25 } })).toEqual([]);
    expect(codes({ riskClass: 'ui', allowedPaths: ['apps/a/x.ts', 'apps/b/y.ts'] }, { thresholds: { packageRoots: 2 } })).toEqual([]);
    expect(codes({ riskClass: 'ui', allowedPaths: ['docs/A.md'] }, { taskCount: 3, thresholds: { tasksPerRequest: 5 } })).toEqual([]);
    expect(PLAN_DEFAULT_THRESHOLDS).toEqual({ tasksPerRequest: 1, estimateUsd: 10, packageRoots: 1 });
  });

  it('says what it could not check rather than guessing', () => {
    expect(planRequirement({ riskClass: 'ui', allowedPaths: ['docs/A.md'] }).unknown).toEqual([
      'which repositories the request touches',
      'how many tasks sit under this request',
      'what the work was estimated at',
    ]);
  });

  it('lists every trigger that fired, not only the first', () => {
    expect(codes({
      riskClass: 'billing',
      allowedPaths: ['apps/api/src/routes/**', 'packages/core/src/billing.ts'],
      estimateUsd: 40,
    }, { taskCount: 4 })).toEqual(['risk_class', 'package_span', 'public_interface', 'task_count', 'estimate']);
  });
});

describe('when the rule offers a plan and lets it be skipped', () => {
  it('offers one for a ui or logic change that touches more than one file', () => {
    for (const riskClass of PLAN_OFFERED_RISK_CLASSES) {
      const decision = planRequirement({ riskClass, allowedPaths: ['apps/web/src/**'] });

      expect(decision.level).toBe('offered');
      expect(decision.offered).toContain(`the risk class is ${riskClass}`);
    }
  });

  it('reads a glob or a directory as more than one file and a named file as one', () => {
    expect(touchesMoreThanOneFile(['apps/web/src/**'])).toBe(true);
    expect(touchesMoreThanOneFile(['apps/web/src/'])).toBe(true);
    expect(touchesMoreThanOneFile(['a.ts', 'b.ts'])).toBe(true);
    expect(touchesMoreThanOneFile(['apps/web/src/a.tsx'])).toBe(false);
    expect(touchesMoreThanOneFile([])).toBe(false);
  });

  it('never offers where it requires', () => {
    const decision = planRequirement({ riskClass: 'logic', allowedPaths: ['apps/web/src/**', 'apps/api/src/**'] });

    expect(decision.level).toBe('required');
    expect(decision.offered).toBeNull();
  });
});

describe('reading the rule off an engineering task', () => {
  it('reads the task\'s own camelCase fields', () => {
    const decision = planRequirementForTask({
      riskClass: 'ui',
      allowedPaths: ['apps/web/src/**', 'packages/core/src/**'],
      repoSlug: 'squatch-core',
      estimateCents: 400,
    });

    expect(decision.level).toBe('required');
    expect(decision.triggers.map(t => t.code)).toEqual(['package_span']);
  });

  it('falls back to the contract the task carries when the record has no copy of a field', () => {
    const decision = planRequirementForTask({
      riskClass: 'logic',
      contract: { allowed_paths: ['apps/web/src/**', 'apps/api/src/**'], environment: { services: ['postgres'] }, token_budget_usd: 20 },
    });

    expect(decision.triggers.map(t => t.code)).toEqual(['package_span', 'estimate']);
  });

  it('reads the estimate in dollars off a cents rollup when the contract states none', () => {
    expect(planRequirementForTask({ riskClass: 'ui', allowedPaths: ['docs/A.md'], estimateCents: 1500 }).triggers.map(t => t.code)).toEqual(['estimate']);
    expect(planRequirementForTask({ riskClass: 'ui', allowedPaths: ['docs/A.md'], estimateCents: 400 }).triggers).toEqual([]);
  });
});

describe('what a task recorded about its plan', () => {
  it('says nothing was recorded, which is not the same as a skip', () => {
    expect(planRecordFromTask({})).toBeNull();
    expect(planRecordFromTask({ plan: null })).toBeNull();
  });

  it('reads either spelling, because the contract writes snake_case and the record writes camelCase', () => {
    expect(planRecordFromTask({ plan: { plan_id: 'PLAN-1', approved_by: 'chris', approved_at: '2026-09-21T10:00:00Z' } }))
      .toEqual({ planId: 'PLAN-1', url: null, approvedBy: 'chris', approvedAt: '2026-09-21T10:00:00Z', skipped: false, skipReason: null });
    expect(planRecordFromTask({ plan: { skipped: true, skipReason: 'one string on one page' } }))
      .toEqual({ planId: null, url: null, approvedBy: null, approvedAt: null, skipped: true, skipReason: 'one string on one page' });
  });

  it('reads a skip with no reason as a skip with no reason, and never fills one in', () => {
    expect(planRecordFromTask({ plan: { skipped: true } })?.skipReason).toBeNull();
    expect(planRecordFromTask({ plan: { skipped: true, skip_reason: '   ' } })?.skipReason).toBeNull();
  });
});
