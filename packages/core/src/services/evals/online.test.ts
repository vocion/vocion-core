/**
 * The lifecycle of something that bills for as long as it exists.
 *
 * Every rule pinned here is one where the quiet version of the mistake shows
 * up on the customer's AWS bill, or tells someone they are not being charged
 * when they are.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('../ApiTokenService', () => ({
  resolveAwsCredentials: vi.fn(async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' })),
}));
vi.mock('./providers/agentcoreOnline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/agentcoreOnline')>();
  return {
    ...actual,
    onlineClient: vi.fn(() => ({})),
    createOnlineConfig: vi.fn(),
    getOnlineConfig: vi.fn(),
    setOnlineConfigEnabled: vi.fn(),
    setOnlineSampling: vi.fn(),
    deleteOnlineConfig: vi.fn(),
  };
});

const { db } = await import('@/libs/DB');
const { evalOnlineConfigSchema } = await import('@/models/Schema');
const {
  createOnlineConfig,
  deleteOnlineConfig,
  getOnlineConfig,
  setOnlineConfigEnabled,
} = await import('./providers/agentcoreOnline');
const {
  describeOnlineEvaluation,
  setOnlineEvaluationEnabled,
  setUpOnlineEvaluation,
  syncOnlineConfig,
  tearDownOnlineEvaluation,
} = await import('./online');

const ROLE = 'arn:aws:iam::111122223333:role/VocionAgentCoreEvaluationExecution';

/** A config AWS reports as existing and switched off. */
const DISABLED_STATE = {
  configId: 'cfg-1',
  configArn: 'arn:1',
  status: 'ACTIVE',
  enabled: false,
  samplingPercentage: 5,
  evaluatorIds: ['Builtin.Correctness'],
  outputLogGroup: '/aws/bedrock-agentcore/evaluations/results/cfg-1',
  failureReason: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN = ROLE;
  await db.delete(evalOnlineConfigSchema);
  vi.mocked(createOnlineConfig).mockResolvedValue({
    configId: 'cfg-1',
    configArn: 'arn:1',
    status: 'CREATING',
    enabled: false,
  });
  vi.mocked(getOnlineConfig).mockResolvedValue(DISABLED_STATE);
});

describe('setUpOnlineEvaluation', () => {
  it('creates the configuration switched off', async () => {
    // Nothing should start sampling because somebody set it up. Turning it on
    // is a second, deliberate act.
    const result = await setUpOnlineEvaluation({ orgId: 'org_a' });

    expect(result.error).toBeNull();
    expect(vi.mocked(createOnlineConfig).mock.calls[0]?.[1]?.enableOnCreate).toBe(false);
    expect(result.state?.enabled).toBe(false);
  });

  it('does not create a second configuration for the same workspace', async () => {
    // Two configurations over the same traffic sample it twice and bill for it
    // twice, and nothing in AWS stops you doing it.
    await setUpOnlineEvaluation({ orgId: 'org_a' });
    vi.mocked(createOnlineConfig).mockClear();

    const second = await setUpOnlineEvaluation({ orgId: 'org_a' });

    expect(createOnlineConfig).not.toHaveBeenCalled();
    expect(second.id).not.toBeNull();
  });

  it('refuses to start without an execution role, before calling AWS', async () => {
    delete process.env.VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN;

    const result = await setUpOnlineEvaluation({ orgId: 'org_a' });

    expect(result.error).toContain('execution role');
    expect(createOnlineConfig).not.toHaveBeenCalled();
  });

  it('says which evaluators it would not run, rather than dropping them', async () => {
    // A person who asked for trajectory matching on live traffic has a wrong
    // mental model, and needs telling — not a silently shorter list.
    const result = await setUpOnlineEvaluation({
      orgId: 'org_a',
      evaluatorIds: ['Builtin.TrajectoryInOrderMatch', 'Builtin.Correctness'],
    });

    expect(result.refused).toEqual(['Builtin.TrajectoryInOrderMatch']);
    expect(result.error).toContain('expected answer');
    expect(result.id).not.toBeNull();
  });

  it('records nothing locally when AWS refuses the create', async () => {
    // A row for a configuration that does not exist would have the page offer
    // an off switch for something that was never on.
    vi.mocked(createOnlineConfig).mockRejectedValueOnce(new Error('role cannot read aws/spans'));

    const result = await setUpOnlineEvaluation({ orgId: 'org_a' });

    expect(result.error).toContain('role cannot read aws/spans');
    expect(await describeOnlineEvaluation('org_a')).toBeNull();
  });
});

describe('setOnlineEvaluationEnabled', () => {
  it('reports the state AWS confirms, not the one we asked for', async () => {
    // If the update is rejected, the page must not go on claiming it is off
    // while AWS keeps sampling and keeps charging.
    await setUpOnlineEvaluation({ orgId: 'org_a' });
    vi.mocked(getOnlineConfig).mockResolvedValue({ ...DISABLED_STATE, enabled: false });

    const state = await setOnlineEvaluationEnabled('org_a', true);

    expect(setOnlineConfigEnabled).toHaveBeenCalledWith(expect.anything(), 'cfg-1', true);
    expect(state?.enabled).toBe(false);
  });

  it('turning it off keeps the configuration', async () => {
    // "Off" means stop sampling and stop billing, not throw away the
    // configuration someone tuned and the history it produced.
    await setUpOnlineEvaluation({ orgId: 'org_a' });

    await setOnlineEvaluationEnabled('org_a', false);

    expect(deleteOnlineConfig).not.toHaveBeenCalled();
    expect(await describeOnlineEvaluation('org_a')).not.toBeNull();
  });

  it('does nothing when no configuration exists', async () => {
    await expect(setOnlineEvaluationEnabled('org_none', true)).resolves.toBeNull();
    expect(setOnlineConfigEnabled).not.toHaveBeenCalled();
  });
});

describe('syncOnlineConfig', () => {
  it('replaces what we assumed with what AWS says', async () => {
    // AWS owns this resource: a create can fail after it returned, and someone
    // can change it in the console. A row written optimistically and never
    // checked tells a person the wrong thing about their bill.
    await setUpOnlineEvaluation({ orgId: 'org_a' });
    vi.mocked(getOnlineConfig).mockResolvedValue({
      ...DISABLED_STATE,
      status: 'ACTIVE',
      enabled: true,
      samplingPercentage: 25,
    });

    await syncOnlineConfig('org_a');

    const summary = await describeOnlineEvaluation('org_a');

    expect(summary?.enabled).toBe(true);
    expect(summary?.samplingPercentage).toBe(25);
  });

  it('records why AWS could not be read', async () => {
    await setUpOnlineEvaluation({ orgId: 'org_a' });
    vi.mocked(getOnlineConfig).mockRejectedValueOnce(new Error('access denied'));

    await expect(syncOnlineConfig('org_a')).resolves.toBeNull();

    const summary = await describeOnlineEvaluation('org_a');

    expect(summary?.failureReason).toContain('access denied');
  });
});

describe('tearDownOnlineEvaluation', () => {
  it('keeps the row when AWS refuses the delete', async () => {
    // Dropping the row first would hide a configuration that is still there
    // and still billable, with nothing left pointing at it.
    await setUpOnlineEvaluation({ orgId: 'org_a' });
    vi.mocked(deleteOnlineConfig).mockRejectedValueOnce(new Error('config is still deleting'));

    await expect(tearDownOnlineEvaluation('org_a')).rejects.toThrow('config is still deleting');

    expect(await describeOnlineEvaluation('org_a')).not.toBeNull();
  });

  it('removes the row once AWS has confirmed', async () => {
    await setUpOnlineEvaluation({ orgId: 'org_a' });

    await tearDownOnlineEvaluation('org_a');

    expect(deleteOnlineConfig).toHaveBeenCalledWith(expect.anything(), 'cfg-1');
    expect(await describeOnlineEvaluation('org_a')).toBeNull();
  });
});
