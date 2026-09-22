import { describe, expect, it, vi } from 'vitest';

const getBusinessObject = vi.fn();

vi.mock('@/services/BusinessObjectService', () => ({ getBusinessObject: (...a: unknown[]) => getBusinessObject(...a) }));

const { readObjectTool, readObjectTools } = await import('./readObject');

const ctx = (slugs: string[]) => ({ orgId: 'org-1', objectTypeSlugs: slugs }) as never;

describe('read_object', () => {
  it('is absent for an agent with no object types to work with', () => {
    expect(readObjectTools(ctx([]))).toHaveLength(0);
    expect(readObjectTools(ctx(['request']))).toHaveLength(1);
  });

  it('refuses a type the agent was not given', async () => {
    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'product', id: 3 });

    expect(out).toContain('does not work with "product"');
  });

  it('returns the record whole — the point of the tool', async () => {
    // lookup_objects caps every value at 120 characters, which is why a lead
    // asked to move six acceptance criteria could see the work and not read it.
    const body = `Acceptance criteria: ${'a fairly long criterion sentence. '.repeat(10)}`;
    getBusinessObject.mockResolvedValue({ id: 3, title: 'Rename', status: 'active', metadata: { body, state: 'building' } });

    const out = await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 3 });
    const parsed = JSON.parse(out as string);

    expect(parsed.body).toBe(body);
    expect(parsed.body.length).toBeGreaterThan(300);
    expect(parsed.state).toBe('building');
    expect(parsed.id).toBe(3);
  });

  it('says so when the id is not a record here', async () => {
    getBusinessObject.mockResolvedValue(null);

    expect(await readObjectTool(ctx(['request'])).invoke({ object_type: 'request', id: 99 })).toContain('No record #99');
  });

  it('will not read a record as the wrong type', async () => {
    getBusinessObject.mockResolvedValue({ id: 4, title: 'Send', status: 'active', metadata: {}, type: { slug: 'product' } });

    expect(await readObjectTool(ctx(['request', 'product'])).invoke({ object_type: 'request', id: 4 })).toContain('is a "product"');
  });
});
