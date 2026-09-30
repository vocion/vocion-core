import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema } = await import('@/models/Schema');
await import('./descriptors');
const { resolvePreview } = await import('./registry');

const ORG = 'org_agent_preview';

describe('an agent opens in the preview pane (a seat on a Configure page)', () => {
  it('says who it is, where it sits and what it runs on, with its page one click away', async () => {
    await db.insert(agentSchema).values({
      orgId: ORG,
      slug: 'desk-lead',
      name: 'Desk lead',
      description: 'Lead. Reads every ask and answers it within a day.',
      systemPrompt: 'never shown in a peek',
      eyebrow: 'Kestrel desk · Lead',
      role: 'lead',
      team: 'kestrel-desk',
      model: 'model-large',
      skillSlugs: ['read-the-ask'],
    });
    const doc = await resolvePreview({ type: 'agent', id: 'desk-lead' }, { orgId: ORG, userId: null });

    expect(doc.title).toBe('Desk lead');
    expect(doc.subtitle).toBe('Kestrel desk · Lead');
    expect(doc.href).toBe('/dashboard/agents/desk-lead');
    expect(doc.facts).toEqual([
      { label: 'Role', value: 'Lead' },
      { label: 'Team', value: 'kestrel-desk' },
      { label: 'Model', value: 'model-large' },
      { label: 'Skills', value: 'read-the-ask' },
    ]);
    expect(doc.body).toBe('Lead. Reads every ask and answers it within a day.');
    expect(JSON.stringify(doc)).not.toContain('never shown in a peek');
  });

  it('another project\'s agent is not found here', async () => {
    const doc = await resolvePreview({ type: 'agent', id: 'desk-lead' }, { orgId: 'org_someone_else', userId: null });

    expect(doc.unresolved).toBeDefined();
  });
});
