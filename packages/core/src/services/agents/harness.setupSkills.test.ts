/**
 * The setup skills a plugin declares (`recommend.setupSkills`, #1028) are
 * mounted on the workspace lead, because setup is a conversation with the
 * lead. The rules someone could get wrong: only the lead gets them, only
 * while the plugin is on, and the lead keeps its own skills.
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
vi.mock('@/services/playbooks/mount', () => ({ mountSkills: vi.fn(async () => ({})) }));
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { mountSkills } = await import('@/services/playbooks/mount');
const { buildInitialFiles } = await import('@/services/agents/harness');

const ORG = 'org_setup_skills';
const SETUP_SKILLS = ['products-from-repos', 'sweep-the-tracker', 'record-the-environments'];

async function seedWorkspace(enabledPlugins: string[]) {
  await db.delete(agentSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-setup-skills', name: 'Northwind', slug: 'northwind-setup-skills' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-setup-skills', slug: 'northwind-setup', name: 'Northwind', leadAgentSlug: 'lead', enabledPlugins });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'lead', name: 'Lead', systemPrompt: 'Lead.', skillSlugs: ['own-skill'], playbookSlugs: [] },
    { orgId: ORG, slug: 'specialist', name: 'Specialist', systemPrompt: 'Specialist.', skillSlugs: ['specialist-skill'], playbookSlugs: [] },
  ]);
}

function mountedFor(): string[] {
  return vi.mocked(mountSkills).mock.calls.at(-1)![0].skillSlugs;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setup skills on the workspace lead', () => {
  it('the lead mounts an enabled plugin\'s setup skills beside its own', async () => {
    await seedWorkspace(['software-factory']);
    await buildInitialFiles(ORG, 'lead');

    expect(mountedFor()).toEqual(expect.arrayContaining(['own-skill', ...SETUP_SKILLS]));
  });

  it('a specialist does not', async () => {
    await seedWorkspace(['software-factory']);
    await buildInitialFiles(ORG, 'specialist');

    expect(mountedFor()).toEqual(['specialist-skill']);
  });

  it('a plugin that is not enabled adds nothing', async () => {
    await seedWorkspace(['wiki']);
    await buildInitialFiles(ORG, 'lead');

    expect(mountedFor()).toEqual(['own-skill']);
  });
});
