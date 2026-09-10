/**
 * `buildInitialFiles` — the last gate before an agent's virtual
 * filesystem is handed to the model.
 *
 * A workspace file whose `{{env.NAME}}` token this deployment cannot
 * resolve must stop the run. Letting it through is the failure mode
 * this whole feature exists to prevent: the model reads the raw token
 * as a real value, invents a plausible one, and nothing looks wrong.
 * So the mount error is logged (with the agent's name, so an operator
 * knows where to look) and then re-thrown, never swallowed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/llm', () => ({
  buildChatModel: vi.fn(() => ({ stub: 'model' })),
  buildChatModelForOrg: vi.fn(async () => ({ stub: 'model' })),
}));
vi.mock('@/services/agents/tools/registry', () => ({ buildDomainTools: vi.fn(() => []) }));
vi.mock('deepagents', () => ({
  createDeepAgent: vi.fn(() => ({ compiled: true })),
  StateBackend: class {},
}));
vi.mock('@/services/playbooks/mount', () => ({ mountSkills: vi.fn() }));
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { db } = await import('@/libs/DB');
const { logger } = await import('@/libs/Logger');
const { agentSchema } = await import('@/models/Schema');
const { mountSkills } = await import('@/services/playbooks/mount');
const { buildInitialFiles } = await import('@/services/agents/harness');

const mockMountSkills = vi.mocked(mountSkills);
const mockLoggerError = vi.mocked(logger.error);

const ORG = 'org_initial_files';
const AGENT = 'ingestor';

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: AGENT,
    name: 'Ingestor',
    systemPrompt: 'Ingest sources.',
    skillSlugs: ['ingest-sources'],
    playbookSlugs: [],
  });
});

describe('buildInitialFiles', () => {
  it('mounts the agent\'s files when every workspace token resolves', async () => {
    mockMountSkills.mockResolvedValue({ '/skills/ingest-sources/SKILL.md': 'Fetch https://api-dev.veerio.app/api/sources.' });

    const files = await buildInitialFiles(ORG, AGENT);

    expect(files['/skills/ingest-sources/SKILL.md']?.content).toBe('Fetch https://api-dev.veerio.app/api/sources.');
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('logs the agent by name and re-throws when a workspace file cannot be mounted', async () => {
    mockMountSkills.mockRejectedValue(new Error('workspace template substitution failed at playbooks/x/SKILL.md'));

    await expect(buildInitialFiles(ORG, AGENT)).rejects.toThrow(/workspace template substitution failed/);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0]?.[0]).toContain(AGENT);
  });

  it('returns nothing for an agent that is not in this org', async () => {
    const files = await buildInitialFiles('some_other_org', AGENT);

    expect(files).toEqual({});
    expect(mockMountSkills).not.toHaveBeenCalled();
  });
});
