/**
 * "Your day", against PGlite: each reachable workspace's latest brief by its
 * headline, the cross-workspace queue with the person's own rows first, one
 * account at a time, kept as a brief in the person's own workspace and
 * replaced rather than duplicated when asked for twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { and, eq, inArray } = await import('drizzle-orm');
const { accountMembershipSchema, askSchema, briefingSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
const { composePersonalBrief, publishPersonalBrief, renderPersonalBrief, headlineOf, PERSONAL_BRIEF_PUBLISHER } = await import('./personal');

const NORTHWIND = 'acct-brief-northwind';
const CONTOSO = 'acct-brief-contoso';
const RILEY = 'usr-brief-riley';
const FACTORY = 'proj-brief-factory';
const REVENUE = 'proj-brief-revenue';
const SUPPLY = 'proj-brief-supply';
const QUIET = 'proj-brief-quiet';

const at = (d: number, h = 9) => new Date(Date.UTC(2026, 9, d, h, 0, 0));
let personal: string;

beforeEach(async () => {
  delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
  delete process.env.NEXT_PUBLIC_APP_URL;
  await db.delete(briefingSchema);
  await db.delete(askSchema);
  await db.delete(projectMemberSchema);
  await db.delete(projectSchema).where(inArray(projectSchema.accountId, [NORTHWIND, CONTOSO]));
  await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.userId, RILEY));
  await db.delete(userSchema).where(eq(userSchema.id, RILEY));
  await db.delete(tenantAccountSchema).where(inArray(tenantAccountSchema.id, [NORTHWIND, CONTOSO]));

  await db.insert(tenantAccountSchema).values([{ id: NORTHWIND, name: 'Northwind', slug: 'northwind' }, { id: CONTOSO, name: 'Contoso Supply', slug: 'contoso' }]);
  await db.insert(userSchema).values({ id: RILEY, email: 'riley@northwind.example', name: 'Riley' });
  await db.insert(accountMembershipSchema).values([{ accountId: NORTHWIND, userId: RILEY, role: 'member' }, { accountId: CONTOSO, userId: RILEY, role: 'member' }]);
  await db.insert(projectSchema).values([
    { id: FACTORY, accountId: NORTHWIND, slug: 'factory', name: 'Northwind Factory' },
    { id: REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue' },
    { id: QUIET, accountId: NORTHWIND, slug: 'quiet', name: 'Archive' },
    { id: SUPPLY, accountId: CONTOSO, slug: 'supply', name: 'Contoso Supply' },
  ]);
  personal = (await ensurePersonalProject(RILEY, NORTHWIND)).id;

  // Factory: a rollup with a summary, and an older team brief it outranks.
  await db.insert(briefingSchema).values([
    { orgId: FACTORY, title: 'Factory brief — Mon, Oct 5, 2026', content: '…', teamSlug: null, publishedBy: 'agent:factory-lead', createdAt: at(5), document: { version: 2, title: 'Factory brief', dateLabel: 'Mon, Oct 5', updatedLabel: 'Updated 9:00 AM', teamSlug: null, today: { summary: 'Two builds shipped; the Kestrel import is blocked on a credential.', metrics: [] } } as never },
    { orgId: FACTORY, title: 'Builds team — Tue, Oct 6, 2026', content: '…', teamSlug: 'builds', publishedBy: 'agent:builds-lead', createdAt: at(6) },
    // Revenue has only a team brief, and no summary: its title is the headline.
    { orgId: REVENUE, title: 'Revenue team — Tue, Oct 6, 2026', content: '…', teamSlug: 'revenue', publishedBy: 'agent:revenue-lead', createdAt: at(6) },
    // Another account's brief never reaches this account's "your day".
    { orgId: SUPPLY, title: 'Contoso brief', content: '…', teamSlug: null, publishedBy: 'agent:supply-lead', createdAt: at(6) },
  ]);
  await db.insert(askSchema).values([
    { orgId: FACTORY, kind: 'approval', title: 'Choose the Kestrel Capital data room vendor', status: 'open', createdBy: RILEY, createdAt: at(4), updatedAt: at(4) },
    { orgId: REVENUE, kind: 'approval', title: 'Sign off the Acme renewal discount', status: 'open', createdBy: 'agent:revenue-lead', createdAt: at(3), updatedAt: at(3) },
    { orgId: SUPPLY, kind: 'approval', title: 'Contoso only: approve the freight quote', status: 'open', createdAt: at(1), updatedAt: at(1) },
  ]);
});

describe('headlineOf', () => {
  it('is the brief\'s own summary, else its title', () => {
    expect(headlineOf({ title: 'T', document: { version: 2, title: 'T', dateLabel: 'd', updatedLabel: 'u', today: { summary: 'S', metrics: [] } } })).toBe('S');
    expect(headlineOf({ title: 'T', document: null })).toBe('T');
  });
});

describe('composePersonalBrief', () => {
  it('leads with what is waiting on the person, then each workspace by its latest brief, for one account', async () => {
    const brief = await composePersonalBrief(RILEY, NORTHWIND, { now: at(7), timeZone: 'UTC' });

    expect(brief.title).toBe('Your day — Wed, Oct 7, 2026');
    expect(brief.waiting).toMatchObject({ total: 2, yours: 1 });
    expect(brief.waiting.top.map(i => i.title)).toEqual(['Choose the Kestrel Capital data room vendor', 'Sign off the Acme renewal discount']);
    expect(brief.workspaces.map(w => w.workspace.id)).toEqual([personal, QUIET, FACTORY, REVENUE]);
    expect(brief.workspaces.map(w => w.workspace.id)).not.toContain(SUPPLY);

    const factory = brief.workspaces.find(w => w.workspace.id === FACTORY)!;

    expect(factory.briefing).toMatchObject({ headline: 'Two builds shipped; the Kestrel import is blocked on a credential.', at: at(5) });
    expect(factory.briefing!.href).toMatch(/^\/w\/factory\/dashboard\/briefings\/\d+\?org=northwind$/);
    expect(brief.workspaces.find(w => w.workspace.id === REVENUE)!.briefing!.headline).toBe('Revenue team — Tue, Oct 6, 2026');

    expect(brief.markdown).toContain('1 is yours, 2 decisions in all, across 2 workspaces.');
    expect(brief.markdown).toContain('— Northwind Factory, yours, waiting since Sun, Oct 4, 2026');
    expect(brief.markdown).toContain('**Northwind Factory** — “Two builds shipped; the Kestrel import is blocked on a credential.” ([brief of Mon, Oct 5, 2026]');
    // A workspace with no brief and nothing waiting is left out, not listed as empty.
    expect(brief.markdown).not.toContain('Archive');
    expect(brief.markdown).not.toContain('Contoso');
  });

  it('says less when there is less: nothing waiting and no briefs is one line', () => {
    expect(renderPersonalBrief({ waiting: { total: 0, yours: 0, top: [] }, workspaces: [], unavailable: [], timeZone: 'UTC' })).toBe('Nothing is waiting on you.');
  });
});

describe('publishPersonalBrief', () => {
  it('keeps the brief in the person\'s own workspace, replaces it when asked again, and never quotes itself', async () => {
    const first = await publishPersonalBrief(RILEY, NORTHWIND, { now: at(7, 8), timeZone: 'UTC' });

    expect(first).toMatchObject({ orgId: personal, replaced: false });
    expect(first.href).toBe(`/w/${(await ensurePersonalProject(RILEY, NORTHWIND)).slug}/dashboard/briefings/${first.id}`);

    const again = await publishPersonalBrief(RILEY, NORTHWIND, { now: at(7, 8), timeZone: 'UTC' });

    expect(again).toMatchObject({ id: first.id, replaced: true });

    const rows = await db.select().from(briefingSchema).where(and(eq(briefingSchema.orgId, personal), eq(briefingSchema.publishedBy, PERSONAL_BRIEF_PUBLISHER)));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe(again.brief.markdown);
    // The personal workspace's own line has no brief: its "your day" is not its headline.
    expect(again.brief.workspaces.find(w => w.workspace.id === personal)!.briefing).toBeNull();
  });
});
