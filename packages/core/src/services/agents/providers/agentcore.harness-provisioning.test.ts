/**
 * Provisioning a managed harness: which harness an apply reaches, and what a
 * missing execution role says.
 *
 * Two hazards this pins:
 *
 * - Agent slugs are unique within an org, not within a deployment. A harness
 *   name built from the slug alone collided across orgs, so the second org's
 *   apply found the FIRST org's harness by name and called `UpdateHarness` on
 *   it — replacing that org's system prompt, model and allowed tools.
 * - Nothing creates `VocionAgentCoreHarnessRole` any more, so a client picking
 *   `aws-managed-harness` got AWS's raw wording about a role they have never
 *   heard of, with no hint that `VOCION_AGENTCORE_ROLE_ARN` exists.
 *
 * The AWS clients are mocked; the database is the real PGlite test one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();

vi.mock('@aws-sdk/client-bedrock-agentcore-control', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-bedrock-agentcore-control')>(
    '@aws-sdk/client-bedrock-agentcore-control',
  );
  return {
    ...actual,
    BedrockAgentCoreControlClient: class {
      send = send;
    },
  };
});

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    /** The account the app is running in, as STS would report it. */
    async send() {
      return { Account: '111122223333' };
    }
  },
  GetCallerIdentityCommand: class {},
}));

vi.mock('@/libs/DB');

const {
  CreateHarnessCommand,
  GetHarnessCommand,
  ListHarnessesCommand,
  UpdateHarnessCommand,
} = await import('@aws-sdk/client-bedrock-agentcore-control');
const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { syncAgentCoreHarness } = await import('./agentcore');

const ORG_A = 'proj_harness_naming_a';
const ORG_B = 'proj_harness_naming_b';
/** Both orgs use the same slug — that is the whole point of these tests. */
const SLUG = 'support-lead';

/**
 * Give both orgs an agent under the shared slug.
 * @param harnessArn - ARN to record on org A's row, or null for none.
 */
async function seedAgents(harnessArn: string | null): Promise<void> {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG_A));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG_B));
  await db.insert(agentSchema).values([
    { orgId: ORG_A, slug: SLUG, name: 'Support Lead A', systemPrompt: 'Prompt A.', harnessArn },
    { orgId: ORG_B, slug: SLUG, name: 'Support Lead B', systemPrompt: 'Prompt B.' },
  ]);
}

/** Commands the provider sent, in order. */
function sentCommands(): unknown[] {
  return send.mock.calls.map(([command]) => command);
}

/**
 * Answer every AgentCore call as an empty account would: nothing listed,
 * creates succeed, and the new harness is READY on the first poll.
 * @param harnessId - Id to hand back from CreateHarness.
 */
function replyAsEmptyAccount(harnessId: string): void {
  const arn = `arn:aws:bedrock-agentcore:us-west-2:111122223333:harness/${harnessId}`;
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof ListHarnessesCommand) {
      return { harnesses: [] };
    }
    if (command instanceof CreateHarnessCommand) {
      return { harness: { harnessId, arn } };
    }
    if (command instanceof GetHarnessCommand) {
      return { harness: { harnessId, arn, status: 'READY' } };
    }
    return {};
  });
}

/** What the override held before these tests started fiddling with it. */
const roleOverrideBefore = process.env.VOCION_AGENTCORE_ROLE_ARN;

afterEach(() => {
  // process.env is shared with every other suite in this worker, so put it
  // back rather than leaving an override behind.
  if (roleOverrideBefore === undefined) {
    delete process.env.VOCION_AGENTCORE_ROLE_ARN;
  } else {
    process.env.VOCION_AGENTCORE_ROLE_ARN = roleOverrideBefore;
  }
});

afterAll(async () => {
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG_A));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG_B));
});

describe('harness naming', () => {
  beforeEach(async () => {
    send.mockReset();
    delete process.env.VOCION_AGENTCORE_ROLE_ARN;
    await seedAgents(null);
  });

  it('gives two orgs sharing an agent slug two different harness names', async () => {
    replyAsEmptyAccount('harness-a');
    await syncAgentCoreHarness(ORG_A, SLUG);
    replyAsEmptyAccount('harness-b');
    await syncAgentCoreHarness(ORG_B, SLUG);

    const created = sentCommands()
      .filter((c): c is InstanceType<typeof CreateHarnessCommand> => c instanceof CreateHarnessCommand)
      .map(c => c.input.harnessName!);

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
    // Same slug, so the readable half matches and only the digest differs.
    expect(created[0]).toContain('vocion_support_lead_');
    expect(created[1]).toContain('vocion_support_lead_');
  });

  it('builds a name AWS accepts, even from a slug longer than the 40-character cap', async () => {
    const longSlug = 'a-really-very-long-agent-slug-that-will-not-fit-in-forty';
    await db.insert(agentSchema).values({
      orgId: ORG_A,
      slug: longSlug,
      name: 'Long',
      systemPrompt: 'Prompt.',
    });
    replyAsEmptyAccount('harness-long');

    await syncAgentCoreHarness(ORG_A, longSlug);

    const [create] = sentCommands()
      .filter((c): c is InstanceType<typeof CreateHarnessCommand> => c instanceof CreateHarnessCommand);
    const name = create!.input.harnessName!;

    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toMatch(/^[a-z]\w{0,39}$/i);
  });

  it('is stable, so a second apply updates the same harness instead of making another', async () => {
    replyAsEmptyAccount('harness-a');
    await syncAgentCoreHarness(ORG_A, SLUG);
    const [firstCreate] = sentCommands()
      .filter((c): c is InstanceType<typeof CreateHarnessCommand> => c instanceof CreateHarnessCommand);
    const name = firstCreate!.input.harnessName!;

    send.mockReset();
    const arn = `arn:aws:bedrock-agentcore:us-west-2:111122223333:harness/harness-a`;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListHarnessesCommand) {
        return { harnesses: [{ harnessId: 'harness-a', harnessName: name, arn }] };
      }
      if (command instanceof GetHarnessCommand) {
        return { harness: { harnessId: 'harness-a', arn, status: 'READY' } };
      }
      return {};
    });

    await syncAgentCoreHarness(ORG_A, SLUG);

    expect(sentCommands().some(c => c instanceof UpdateHarnessCommand)).toBe(true);
    expect(sentCommands().some(c => c instanceof CreateHarnessCommand)).toBe(false);
  });
});

describe('harness already recorded on the agent row', () => {
  const OLD_ARN = 'arn:aws:bedrock-agentcore:us-west-2:111122223333:harness/vocion_support_lead-OLD';

  beforeEach(async () => {
    send.mockReset();
    delete process.env.VOCION_AGENTCORE_ROLE_ARN;
    await seedAgents(OLD_ARN);
  });

  it('updates the recorded harness, so an older name is not abandoned and duplicated', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetHarnessCommand) {
        return { harness: { harnessId: 'vocion_support_lead-OLD', arn: OLD_ARN, status: 'READY' } };
      }
      return {};
    });

    const arn = await syncAgentCoreHarness(ORG_A, SLUG);

    expect(arn).toBe(OLD_ARN);

    const commands = sentCommands();

    expect(commands.some(c => c instanceof UpdateHarnessCommand)).toBe(true);
    expect(commands.some(c => c instanceof CreateHarnessCommand)).toBe(false);
    // No name lookup needed at all when the row already knows its harness.
    expect(commands.some(c => c instanceof ListHarnessesCommand)).toBe(false);
  });

  it('provisions a new harness when the recorded one has been deleted out from under us', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ResourceNotFoundException } = await import('@aws-sdk/client-bedrock-agentcore-control');
    let getCalls = 0;
    const newArn = 'arn:aws:bedrock-agentcore:us-west-2:111122223333:harness/harness-new';
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetHarnessCommand) {
        getCalls += 1;
        if (getCalls === 1) {
          throw new ResourceNotFoundException({ message: 'harness not found', $metadata: {} });
        }
        return { harness: { harnessId: 'harness-new', arn: newArn, status: 'READY' } };
      }
      if (command instanceof ListHarnessesCommand) {
        return { harnesses: [] };
      }
      if (command instanceof CreateHarnessCommand) {
        return { harness: { harnessId: 'harness-new', arn: newArn } };
      }
      return {};
    });

    await expect(syncAgentCoreHarness(ORG_A, SLUG)).resolves.toBe(newArn);
    expect(sentCommands().some(c => c instanceof CreateHarnessCommand)).toBe(true);
    // The row pointed somewhere real once, so say so rather than replacing the
    // harness silently.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));

    warn.mockRestore();
  });

  it('replaces the recorded harness on an unmodelled not-found as well', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const newArn = 'arn:aws:bedrock-agentcore:us-west-2:111122223333:harness/harness-new';
    let getCalls = 0;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetHarnessCommand) {
        getCalls += 1;
        if (getCalls === 1) {
          // The shape the SDK's parser does not recognise: a plain error whose
          // only marker is the AWS code in `name`. Matching the modelled class
          // alone would rethrow this instead of replacing the harness.
          const unparsed = new Error('Harness not found');
          unparsed.name = 'ResourceNotFoundException';
          throw unparsed;
        }
        return { harness: { harnessId: 'harness-new', arn: newArn, status: 'READY' } };
      }
      if (command instanceof ListHarnessesCommand) {
        return { harnesses: [] };
      }
      if (command instanceof CreateHarnessCommand) {
        return { harness: { harnessId: 'harness-new', arn: newArn } };
      }
      return {};
    });

    await expect(syncAgentCoreHarness(ORG_A, SLUG)).resolves.toBe(newArn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));

    warn.mockRestore();
  });
});

describe('the harness execution role', () => {
  beforeEach(async () => {
    send.mockReset();
    delete process.env.VOCION_AGENTCORE_ROLE_ARN;
    await seedAgents(null);
  });

  it('says which role to create, and that an override exists, when AWS rejects it', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListHarnessesCommand) {
        return { harnesses: [] };
      }
      throw new Error(
        'ValidationException: executionRoleArn arn:aws:iam::111122223333:role/VocionAgentCoreHarnessRole does not exist',
      );
    });

    await expect(syncAgentCoreHarness(ORG_A, SLUG)).rejects.toThrow(
      /VocionAgentCoreHarnessRole was rejected[\s\S]*VOCION_AGENTCORE_ROLE_ARN/,
    );
  });

  it('passes any failure unrelated to the role through untouched', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListHarnessesCommand) {
        return { harnesses: [] };
      }
      throw new Error('ThrottlingException: slow down');
    });

    await expect(syncAgentCoreHarness(ORG_A, SLUG)).rejects.toThrow('ThrottlingException: slow down');
  });

  it('uses VOCION_AGENTCORE_ROLE_ARN verbatim when it is set, without asking STS', async () => {
    process.env.VOCION_AGENTCORE_ROLE_ARN = 'arn:aws:iam::999988887777:role/ClientOwnedHarnessRole';
    replyAsEmptyAccount('harness-a');

    await syncAgentCoreHarness(ORG_A, SLUG);

    const [create] = sentCommands()
      .filter((c): c is InstanceType<typeof CreateHarnessCommand> => c instanceof CreateHarnessCommand);

    expect(create!.input.executionRoleArn).toBe('arn:aws:iam::999988887777:role/ClientOwnedHarnessRole');
  });
});
