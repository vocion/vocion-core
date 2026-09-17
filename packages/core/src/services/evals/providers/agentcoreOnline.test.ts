/**
 * What these tests defend.
 *
 * Online evaluation costs money continuously and produces a number that looks
 * like a pass rate but is not one. Both of those are places where a quiet
 * mistake is expensive: a ground-truth evaluator that silently scores nothing
 * useful, or a configuration that starts sampling the moment it exists.
 */

import type { GetOnlineEvaluationConfigCommandOutput } from '@aws-sdk/client-bedrock-agentcore-control';
import { describe, expect, it } from 'vitest';
import {
  buildOnlineConfigRequest,
  parseOnlineConfig,
  refuseGroundTruthEvaluators,
} from './agentcoreOnline';

const BASE = {
  name: 'vocion-online-org-1',
  executionRoleArn: 'arn:aws:iam::111122223333:role/VocionAgentCoreEvaluationExecution',
  serviceNames: ['vocion_agent_runtime_dev'],
  logGroupNames: ['aws/spans'],
};

describe('refuseGroundTruthEvaluators', () => {
  it('refuses an evaluator that needs a right answer to compare against', () => {
    // Live traffic has no expected answer. A trajectory evaluator here has
    // nothing to match against, and whatever it publishes would sit on a
    // CloudWatch dashboard looking like correctness.
    const { usable, refused, reason } = refuseGroundTruthEvaluators([
      'Builtin.TrajectoryInOrderMatch',
      'Builtin.Correctness',
    ]);

    expect(refused).toEqual(['Builtin.TrajectoryInOrderMatch']);
    expect(usable).toEqual(['Builtin.Correctness']);
    expect(reason).toContain('expected answer');
  });

  it('catches a ground-truth evaluator it has never seen', () => {
    // Matched by substring rather than an allow-list, because AWS keeps adding
    // evaluators and a list that falls behind lets exactly this through.
    const { refused } = refuseGroundTruthEvaluators(['Builtin.SomethingTrajectoryNew']);

    expect(refused).toEqual(['Builtin.SomethingTrajectoryNew']);
  });

  it('reports the refusal rather than quietly dropping it', () => {
    // Silently filtering would leave a person believing their evaluator was
    // running against production traffic.
    const { refused, reason } = refuseGroundTruthEvaluators(['Builtin.TrajectoryExactMatch']);

    expect(refused).toHaveLength(1);
    expect(reason).toContain('Builtin.TrajectoryExactMatch');
  });

  it('lets a self-judging evaluator through', () => {
    const { usable, refused } = refuseGroundTruthEvaluators(['Builtin.Correctness', 'Builtin.Helpfulness']);

    expect(usable).toHaveLength(2);
    expect(refused).toEqual([]);
  });
});

describe('buildOnlineConfigRequest', () => {
  it('creates the configuration switched off', () => {
    // The default has to be "exists but is not spending anything". A config
    // that samples from the moment it is created means the first anyone hears
    // about the bill is the bill.
    const request = buildOnlineConfigRequest({ ...BASE, evaluatorIds: ['Builtin.Correctness'] });

    expect(request.enableOnCreate).toBe(false);
  });

  it('starts enabled only when explicitly asked', () => {
    const request = buildOnlineConfigRequest({
      ...BASE,
      evaluatorIds: ['Builtin.Correctness'],
      enableOnCreate: true,
    });

    expect(request.enableOnCreate).toBe(true);
  });

  it('never sends an evaluator that needs ground truth', () => {
    const request = buildOnlineConfigRequest({
      ...BASE,
      evaluatorIds: ['Builtin.TrajectoryInOrderMatch', 'Builtin.Correctness'],
    });

    expect(request.evaluators).toEqual([{ evaluatorId: 'Builtin.Correctness' }]);
  });

  it('refuses to create a config that could never score anything', () => {
    // AWS accepts a config with no usable evaluators. It then samples traffic,
    // scores nothing, and bills for existing — a standing cost for no signal.
    expect(() => buildOnlineConfigRequest({
      ...BASE,
      evaluatorIds: ['Builtin.TrajectoryInOrderMatch'],
    })).toThrow(/cannot run any of the evaluators/);
  });

  it('defaults sampling to a small share of traffic', () => {
    // Every sampled session is a paid judge call on the customer's account, so
    // the default has to be a sample rather than everything.
    const request = buildOnlineConfigRequest({ ...BASE, evaluatorIds: ['Builtin.Correctness'] });

    expect(request.rule?.samplingConfig?.samplingPercentage).toBe(5);
  });

  it('rejects a sampling percentage outside the range', () => {
    expect(() => buildOnlineConfigRequest({
      ...BASE,
      evaluatorIds: ['Builtin.Correctness'],
      samplingPercentage: 0,
    })).toThrow(/between 0 and 100/);
    expect(() => buildOnlineConfigRequest({
      ...BASE,
      evaluatorIds: ['Builtin.Correctness'],
      samplingPercentage: 140,
    })).toThrow(/between 0 and 100/);
  });

  it('points at the service name and log group the runtime writes to', () => {
    // Same join as the batch path: wrong here and it samples nothing while
    // looking perfectly healthy.
    const request = buildOnlineConfigRequest({ ...BASE, evaluatorIds: ['Builtin.Correctness'] });

    expect(request.dataSourceConfig?.cloudWatchLogs?.serviceNames).toEqual(['vocion_agent_runtime_dev']);
    expect(request.dataSourceConfig?.cloudWatchLogs?.logGroupNames).toEqual(['aws/spans']);
  });

  it('carries the execution role AWS runs as', () => {
    const request = buildOnlineConfigRequest({ ...BASE, evaluatorIds: ['Builtin.Correctness'] });

    expect(request.evaluationExecutionRoleArn).toBe(BASE.executionRoleArn);
  });
});

describe('parseOnlineConfig', () => {
  it('tells an existing config apart from a running one', () => {
    // The whole cost story. ACTIVE is the resource's lifecycle; DISABLED means
    // nothing is being sampled and nothing is being charged. Collapsing the
    // two would have the page tell someone they are paying when they are not,
    // or worse, the reverse.
    const state = parseOnlineConfig({
      $metadata: {},
      onlineEvaluationConfigId: 'cfg-1',
      onlineEvaluationConfigArn: 'arn:aws:bedrock-agentcore:us-west-2:111122223333:online-evaluation-config/cfg-1',
      status: 'ACTIVE',
      executionStatus: 'DISABLED',
    } as GetOnlineEvaluationConfigCommandOutput);

    expect(state.status).toBe('ACTIVE');
    expect(state.enabled).toBe(false);
  });

  it('reads a running config as running', () => {
    const state = parseOnlineConfig({
      $metadata: {},
      onlineEvaluationConfigId: 'cfg-1',
      onlineEvaluationConfigArn: 'arn:1',
      status: 'ACTIVE',
      executionStatus: 'ENABLED',
      rule: { samplingConfig: { samplingPercentage: 10 } },
      evaluators: [{ evaluatorId: 'Builtin.Correctness' }],
      outputConfig: { cloudWatchConfig: { logGroupName: '/aws/bedrock-agentcore/evaluations/results/cfg-1' } },
    } as GetOnlineEvaluationConfigCommandOutput);

    expect(state.enabled).toBe(true);
    expect(state.samplingPercentage).toBe(10);
    expect(state.evaluatorIds).toEqual(['Builtin.Correctness']);
    expect(state.outputLogGroup).toBe('/aws/bedrock-agentcore/evaluations/results/cfg-1');
  });

  it('keeps the reason a config failed', () => {
    // A create can fail asynchronously. Without this the row would sit at
    // CREATING forever with nothing saying why.
    const state = parseOnlineConfig({
      $metadata: {},
      onlineEvaluationConfigId: 'cfg-1',
      onlineEvaluationConfigArn: 'arn:1',
      status: 'CREATE_FAILED',
      executionStatus: 'DISABLED',
      failureReason: 'execution role cannot read aws/spans',
    } as GetOnlineEvaluationConfigCommandOutput);

    expect(state.status).toBe('CREATE_FAILED');
    expect(state.failureReason).toBe('execution role cannot read aws/spans');
    expect(state.enabled).toBe(false);
  });
});
