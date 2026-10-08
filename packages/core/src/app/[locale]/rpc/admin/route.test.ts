import process from 'node:process';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The System page's figures, on a host that serves several companies.
 *
 * Two accounts share the database here — Kestrel and Northwind — plus an
 * operator of the installation. A member of one company must see only that
 * company's counts and no service links; only an operator
 * (`VOCION_OPERATOR_EMAILS`) sees the whole installation and the service
 * health, probed at the addresses the deployment configured, never a
 * hard-coded localhost.
 *
 * And it must COUNT, never load rows: on 2026-09-25 it selected every agent,
 * skill, object and knowledge chunk (with embeddings) to read `.length`, the
 * calls piled up, and production ran out of heap twice. Fixtures are
 * fictional.
 */

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { clerkAuth } = await import('@/libs/Auth');
const { businessObjectSchema, businessObjectTypeSchema, userSchema } = await import('@/models/Schema');
const { GET } = await import('./route');

const KESTREL = 'org_kestrel_admin_counts';
const NORTHWIND = 'org_northwind_admin_counts';

type Body = {
  scope: 'installation' | 'workspace';
  services: Array<{ name: string; url: string; externalUrl: string }>;
  db: { objects: number; objectTypes: number };
};

function signedInAs(userId: string | null, orgId: string | null) {
  vi.mocked(clerkAuth).mockResolvedValue({ userId, orgId, projectId: orgId } as Awaited<ReturnType<typeof clerkAuth>>);
}

async function seedObjects(orgId: string, n: number) {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: 'request', label: 'Request', schema: {} } as never).returning({ id: businessObjectTypeSchema.id });
  await db.insert(businessObjectSchema).values(Array.from({ length: n }, (_, i) => ({ orgId, typeId: type!.id, title: `${orgId} ${i}`, metadata: { body: 'x'.repeat(1000) } })) as never);
}

const ENV_KEYS = ['VOCION_OPERATOR_EMAILS', 'NEXT_PUBLIC_APP_URL', 'LANGFUSE_BASE_URL', 'NEXT_PUBLIC_LANGFUSE_BASE_URL'] as const;
const saved: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};

beforeAll(async () => {
  await seedObjects(KESTREL, 3);
  await seedObjects(NORTHWIND, 5);
  await db.insert(userSchema).values([
    { id: 'usr-kestrel-member', name: 'Kestrel Member', email: 'member@kestrel.example' },
    { id: 'usr-operator', name: 'Operator', email: 'ops@vocion-host.example' },
  ]);
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.VOCION_OPERATOR_EMAILS = 'OPS@vocion-host.example, someone-else@vocion-host.example';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  vi.restoreAllMocks();
});

describe('/rpc/admin', () => {
  it('refuses a caller with no session', async () => {
    signedInAs(null, null);

    expect((await GET()).status).toBe(401);
  });

  it('shows a company member their own workspace\'s counts only — never the other company\'s, never service links', async () => {
    signedInAs('usr-kestrel-member', KESTREL);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vocion-host.example';

    const res = await GET();
    const body = await res.json() as Body;

    expect(res.status).toBe(200);
    expect(body.scope).toBe('workspace');
    expect(body.db.objects).toBe(3);
    expect(body.db.objectTypes).toBe(1);
    expect(body.services).toEqual([]);
    // No probe at all: service health is the operator's.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the other company its own figures, not the first company\'s', async () => {
    signedInAs('usr-northwind-member', NORTHWIND);

    const body = await (await GET()).json() as Body;

    expect(body.scope).toBe('workspace');
    expect(body.db.objects).toBe(5);
  });

  it('refuses a signed-in non-operator with no workspace rather than counting the installation', async () => {
    signedInAs('usr-kestrel-member', null);

    expect((await GET()).status).toBe(403);
  });

  it('is not an operator\'s view just because the email list is set and the caller is an admin of an account', async () => {
    // An account admin on a shared host is one company among several.
    signedInAs('usr-kestrel-member', KESTREL);

    const body = await (await GET()).json() as Body;

    expect(body.scope).toBe('workspace');
  });

  it('shows an operator the installation, and probes the services at the configured addresses', async () => {
    signedInAs('usr-operator', KESTREL);
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vocion-host.example/';
    process.env.LANGFUSE_BASE_URL = 'http://langfuse-web:3000';
    process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL = 'https://langfuse.vocion-host.example';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const body = await (await GET()).json() as Body;

    expect(body.scope).toBe('installation');
    expect(body.db.objects).toBe(8);
    expect(body.db.objectTypes).toBe(2);
    expect(body.services.map(s => [s.name, s.url, s.externalUrl])).toEqual([
      ['Vocion App', 'https://app.vocion-host.example/version.txt', 'https://app.vocion-host.example'],
      ['Langfuse', 'http://langfuse-web:3000/api/public/health', 'https://langfuse.vocion-host.example'],
    ]);
    expect(fetchSpy.mock.calls.map(c => String(c[0]))).toEqual([
      'https://app.vocion-host.example/version.txt',
      'http://langfuse-web:3000/api/public/health',
    ]);
  });

  it('never invents a localhost service when the deployment configured none', async () => {
    signedInAs('usr-operator', KESTREL);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const body = await (await GET()).json() as Body;

    expect(body.services).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats an unset operator list as nobody', async () => {
    delete process.env.VOCION_OPERATOR_EMAILS;
    signedInAs('usr-operator', KESTREL);

    const body = await (await GET()).json() as Body;

    expect(body.scope).toBe('workspace');
    expect(body.db.objects).toBe(3);
  });

  it('reports counts and never selects whole rows', async () => {
    signedInAs('usr-kestrel-member', KESTREL);
    const select = vi.spyOn(db, 'select');

    await GET();

    // Every select is a projection (count or the operator email), never
    // `select()` of whole rows.
    expect(select).toHaveBeenCalled();

    for (const call of select.mock.calls) {
      expect(call.length).toBeGreaterThan(0);
    }
  });
});
