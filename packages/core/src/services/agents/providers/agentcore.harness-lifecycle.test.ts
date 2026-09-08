/**
 * How a managed harness is found and how it is deleted.
 *
 * Both were reviewed as hazards on the same change, and both are about
 * `ListHarnesses` returning ONE page plus a `nextToken`:
 *
 * - The create/update path looks a harness up by name. Reading only the first
 *   page makes a harness past it read as absent, and a second harness then
 *   gets created under the same name.
 * - The delete path must not depend on that lookup at all. `harnessNameFor` is
 *   `vocion_<slug>` with no org in it, so two orgs whose agents share a slug
 *   map to one name; deleting by name would let one org's workspace apply
 *   delete another org's harness. It deletes by the id inside the ARN stored
 *   on that org's own row instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/libs/DB');

const { DeleteHarnessCommand, ListHarnessesCommand, ResourceNotFoundException } = await import(
  '@aws-sdk/client-bedrock-agentcore-control',
);
const { deleteAgentCoreHarness } = await import('./agentcore');

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:1234:harness/vocion_event_ingestion_lead-QumHO9jDwy';

/**
 * A not-found built by the SDK itself, so the `instanceof` check in the
 * provider matches the real thing rather than a look-alike.
 */
function notFound(): InstanceType<typeof ResourceNotFoundException> {
  return new ResourceNotFoundException({ message: 'harness not found', $metadata: {} });
}

describe('deleteAgentCoreHarness', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('deletes the id carried in the ARN, without listing anything', async () => {
    send.mockResolvedValue({});

    const result = await deleteAgentCoreHarness(ARN);

    expect(result).toEqual({ deleted: true, harnessId: 'vocion_event_ingestion_lead-QumHO9jDwy' });

    const commands = send.mock.calls.map(([command]) => command);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteHarnessCommand);
    expect(commands.some(c => c instanceof ListHarnessesCommand)).toBe(false);
    expect((commands[0] as InstanceType<typeof DeleteHarnessCommand>).input).toEqual({
      harnessId: 'vocion_event_ingestion_lead-QumHO9jDwy',
    });
  });

  it('treats an already-deleted harness as done, so the row can be cleared', async () => {
    send.mockRejectedValue(notFound());

    await expect(deleteAgentCoreHarness(ARN)).resolves.toEqual({
      deleted: false,
      harnessId: 'vocion_event_ingestion_lead-QumHO9jDwy',
    });
  });

  it('rethrows any other failure, so the caller keeps the ARN and retries', async () => {
    send.mockRejectedValue(new Error('AccessDeniedException on DeleteHarness'));

    await expect(deleteAgentCoreHarness(ARN)).rejects.toThrow('AccessDeniedException');
  });

  it('refuses an ARN it cannot read an id out of, rather than deleting nothing quietly', async () => {
    await expect(deleteAgentCoreHarness('')).rejects.toThrow(/cannot read a harness id/);
    expect(send).not.toHaveBeenCalled();
  });
});
