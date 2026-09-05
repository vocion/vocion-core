/**
 * The Apollo list tools — the staging area, and the four ported behaviours
 * that have to survive the port:
 *
 *   - adding to a list creates the saved contact and, implicitly, the list;
 *   - a list name that already exists case-insensitively is reused with ITS
 *     casing, so near-duplicate lists do not pile up;
 *   - removal is membership only and never deletes the contact, and it says
 *     which lists remain;
 *   - `raw_json` still carries everything the normalized row drops.
 *
 * Plus the gates: no tools without an apollo source in scope, and no WRITES
 * without the grant, because an Apollo list can feed a live cadence.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, toolCallSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { apolloListTools, matchLabel } = await import('./apolloLists');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_apollo_lists';
const WRITES = ['apollo_add_to_list', 'apollo_remove_from_list'];

/**
 * A runtime context for one org.
 * @param orgId - Whose workspace.
 * @param sources - The agent's connectorSources.
 * @param grants - Tool names granted via harness config.
 * @param allowed - The per-user source ACL, when there is one.
 */
function ctxFor(orgId = ORG, sources: string[] = ['apollo'], grants: string[] = WRITES, allowed?: string[]): RuntimeContext {
  return {
    orgId,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: sources,
    ...(allowed ? { allowedSourceSlugs: allowed } : {}),
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: { grantTools: grants },
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(ctx = ctxFor()): Map<string, Invokable> {
  return new Map((apolloListTools(ctx) as unknown as Invokable[]).map(t => [t.name, t]));
}

async function call(tool: Invokable | undefined, args: Record<string, unknown> = {}) {
  return JSON.parse(await tool!.invoke(args));
}

/**
 * One canned response.
 * @param status - HTTP status.
 * @param body - JSON body.
 */
function res(status: number, body: unknown): Response {
  return {
    ok: status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const LABELS = [
  { id: 'lab_1', name: 'MSP Outbound', modality: 'contacts', cached_count: 42, updated_at: '2026-09-01T00:00:00Z' },
  { id: 'lab_2', name: 'PPC agencies', modality: 'contacts', cached_count: 7, updated_at: '2026-08-20T00:00:00Z' },
];

const SAVED_CONTACT = {
  id: 'con_1',
  first_name: 'Dana',
  last_name: 'Reyes',
  title: 'VP Marketing',
  email: 'dana@acme.com',
  email_status: 'verified',
  city: 'Denver',
  state: 'CO',
  organization: { name: 'Acme' },
  label_ids: ['lab_1', 'lab_2'],
  typed_custom_fields: { persona: 'operator' },
};

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'apollo-key' });
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'apollo', kind: 'plugin', configJson: { _connector: 'apollo' } });
});

afterAll(async () => {
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
});

describe('apollo_list_labels', () => {
  it('reports id, count and modality per list, counts first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: LABELS })));

    const out = await call(toolsByName().get('apollo_list_labels'));

    expect(out).toMatchObject({ ok: true, total: 2, total_in_account: 2 });
    expect(out.labels[0]).toEqual({
      id: 'lab_1',
      name: 'MSP Outbound',
      modality: 'contacts',
      count: 42,
      updated_at: '2026-09-01T00:00:00Z',
    });
  });

  it('filters by name, case-insensitively', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, LABELS)));

    const out = await call(toolsByName().get('apollo_list_labels'), { name_filter: 'msp' });

    expect(out.total).toBe(1);
    expect(out.total_in_account).toBe(2);
    expect(out.labels[0].name).toBe('MSP Outbound');
  });

  it('says an empty result proves nothing about what exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: [] })));

    const out = await call(toolsByName().get('apollo_list_labels'));

    expect(out.absence).toContain('proves presence, never absence');
  });
});

describe('apollo_list_contacts', () => {
  it('returns normalized rows and keeps the raw record alongside them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      contacts: [SAVED_CONTACT],
      pagination: { page: 1, per_page: 25, total_entries: 42, total_pages: 2 },
    })));

    const out = await call(toolsByName().get('apollo_list_contacts'), { label_id: 'lab_1' });

    expect(out).toMatchObject({ ok: true, total: 42, returned: 1, page: 1, has_more: true });
    expect(out.contacts[0]).toMatchObject({
      id: 'con_1',
      name: 'Dana Reyes',
      title: 'VP Marketing',
      email: 'dana@acme.com',
      email_verified: true,
      company: 'Acme',
    });
    // The passthrough: signals the normalized row drops are still reachable.
    expect(out.contacts[0].raw_json.typed_custom_fields).toEqual({ persona: 'operator' });
  });

  it('reports the total rather than the page size', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      contacts: [SAVED_CONTACT],
      pagination: { total_entries: 855, total_pages: 35 },
    })));

    const out = await call(toolsByName().get('apollo_list_contacts'), { label_id: 'lab_1' });

    expect(out.note).toContain('855');
  });

  it('asks for the label id rather than guessing one', async () => {
    const out = await call(toolsByName().get('apollo_list_contacts'), { label_id: '  ' });

    expect(out).toMatchObject({ ok: false, error: 'bad_argument' });
  });
});

describe('apollo_add_to_list', () => {
  it('creates the saved contact and, implicitly, a list that does not exist yet', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/labels')) {
        return res(200, { labels: LABELS });
      }
      bodies.push(String(init?.body ?? ''));
      return res(200, { contact: { id: 'con_9', email: 'dana@acme.com' } });
    }));

    const out = await call(toolsByName().get('apollo_add_to_list'), {
      list_name: 'Construction ICP',
      contact: { email: 'dana@acme.com', first_name: 'Dana', company: 'Acme' },
    });

    expect(out).toMatchObject({ ok: true, list_name: 'Construction ICP', list_created: true, contact_id: 'con_9' });
    expect(bodies[0]).toContain('"label_names":["Construction ICP"]');
    // Staging, not promotion: the HubSpot write stays a separate decision.
    expect(out.note).toContain('does NOT create a HubSpot record');
  });

  it('matches an existing list case-insensitively, and the existing casing wins', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/labels')) {
        return res(200, { labels: LABELS });
      }
      bodies.push(String(init?.body ?? ''));
      return res(200, { contact: { id: 'con_9' } });
    }));

    const out = await call(toolsByName().get('apollo_add_to_list'), {
      list_name: 'msp outbound',
      contact: { email: 'dana@acme.com' },
    });

    expect(out).toMatchObject({ ok: true, list_name: 'MSP Outbound', list_created: false });
    expect(bodies[0]).toContain('"label_names":["MSP Outbound"]');
    expect(out.matched_existing_casing).toContain('MSP Outbound');
  });

  it('needs an email to save anyone', async () => {
    const out = await call(toolsByName().get('apollo_add_to_list'), { list_name: 'MSP Outbound', contact: {} });

    expect(out).toMatchObject({ ok: false, error: 'bad_argument' });
  });
});

describe('apollo_remove_from_list', () => {
  it('removes the membership and returns the lists that remain', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      if (String(url).endsWith('/contacts/search')) {
        return res(200, { contacts: [SAVED_CONTACT] });
      }
      return res(200, { contact: { ...SAVED_CONTACT, label_ids: ['lab_2'] } });
    }));

    const out = await call(toolsByName().get('apollo_remove_from_list'), { contact_id: 'con_1', label_id: 'lab_1' });

    expect(out).toMatchObject({ ok: true, removed: true, remaining_label_ids: ['lab_2'] });
    // Membership only: the update writes the remaining labels, it does not
    // delete the contact.
    expect(calls[1]!.url).toContain('/api/v1/contacts/con_1');
    expect(calls[1]!.body).toBe(JSON.stringify({ label_ids: ['lab_2'] }));
    expect(out.note).toContain('the saved contact still exists');
  });

  it('says not_a_member rather than pretending to have removed something', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return res(200, { contacts: [{ ...SAVED_CONTACT, label_ids: ['lab_2'] }] });
    }));

    const out = await call(toolsByName().get('apollo_remove_from_list'), { contact_id: 'con_1', label_id: 'lab_1' });

    expect(out).toMatchObject({ ok: true, removed: false, reason: 'not_a_member', remaining_label_ids: ['lab_2'] });
    // Nothing was written.
    expect(calls).toHaveLength(1);
  });

  it('reports a contact Apollo does not hold as an absence, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { contacts: [] })));

    const out = await call(toolsByName().get('apollo_remove_from_list'), { contact_id: 'con_x', label_id: 'lab_1' });

    expect(out).toMatchObject({ ok: true, removed: false, reason: 'no_such_contact' });
  });
});

describe('matchLabel', () => {
  it('matches on trimmed, case-folded names and returns the existing record', () => {
    expect(matchLabel(LABELS, '  msp OUTBOUND ')?.name).toBe('MSP Outbound');
    expect(matchLabel(LABELS, 'MSP')).toBeUndefined();
  });
});

describe('gates', () => {
  it('builds no Apollo tools for an agent with no apollo source', async () => {
    const names = buildDomainTools(ctxFor(ORG, ['hubspot'])).map(t => t.name);

    expect(names.some(name => name.startsWith('apollo_'))).toBe(false);
  });

  it('builds the reads but not the writes without the grant', () => {
    const names = [...toolsByName(ctxFor(ORG, ['apollo'], [])).keys()];

    expect(names).toEqual(['apollo_list_labels', 'apollo_list_contacts']);
  });

  it('builds a granted write, and only the one granted', () => {
    const names = [...toolsByName(ctxFor(ORG, ['apollo'], ['apollo_add_to_list'])).keys()];

    expect(names).toContain('apollo_add_to_list');
    expect(names).not.toContain('apollo_remove_from_list');
  });

  it('honours a per-user source ACL that excludes apollo', async () => {
    const names = buildDomainTools(ctxFor(ORG, ['apollo', 'hubspot'], WRITES, ['hubspot'])).map(t => t.name);

    expect(names.some(name => name.startsWith('apollo_'))).toBe(false);
  });

  it('returns nothing from another org\'s Apollo source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: LABELS })));

    const out = await call(toolsByName(ctxFor('org_other')).get('apollo_list_labels'));

    expect(out).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
    expect(out.message).toContain('No Apollo source is connected');
  });
});

describe('errors are data', () => {
  it('names the Sources-page fix when the vault holds no key', async () => {
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    const out = await call(toolsByName().get('apollo_list_labels'));

    expect(out).toMatchObject({ ok: false, error: 'no_apollo_credentials' });
    expect(out.message).toContain('Sources page');
  });

  it('hands a rejected key back as data rather than throwing into the turn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: 'Invalid API key' })));

    const out = await call(toolsByName().get('apollo_list_labels'));

    expect(out).toMatchObject({ ok: false, error: 'apollo_unauthorized' });
  });
});

describe('the activity record', () => {
  it('lands one tool_call row per Apollo call, attributed to the acting agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { labels: LABELS })));
    const { eq } = await import('drizzle-orm');
    await db.delete(toolCallSchema).where(eq(toolCallSchema.orgId, ORG));

    // Through the registry, which is where withToolCallRecord wraps every
    // tool — one seam covering all three harness providers.
    const listLabels = buildDomainTools(ctxFor()).find(t => t.name === 'apollo_list_labels');
    await (listLabels as unknown as Invokable).invoke({});

    // The write is fire-and-forget; give it a beat.
    await vi.waitFor(async () => {
      const rows = await db.select().from(toolCallSchema).where(eq(toolCallSchema.orgId, ORG));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.tool).toBe('apollo_list_labels');
      expect(rows[0]!.agentSlug).toBe('revenue-lead');
    });
    await db.delete(toolCallSchema).where(eq(toolCallSchema.orgId, ORG));
  });
});
