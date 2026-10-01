import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { askSchema, businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { codeForRecord, resolveCode, typeCodesForOrg } = await import('./codes');

const ORG = 'proj_codes_northwind';
const OTHER = 'proj_codes_kestrel';
let feature = 0;
let plan = 0;
let deal = 0;
let run = 0;
let ask = 0;

beforeAll(async () => {
  const [request, planType, dealType] = await db.insert(businessObjectTypeSchema).values([
    { orgId: ORG, slug: 'request', label: 'Request', schema: { 'x-code': 'FE' } },
    { orgId: ORG, slug: 'architecture_plan', label: 'Plan', schema: { 'x-code': 'PL' } },
    // Created before codes existed: no stored code, so one is derived.
    { orgId: ORG, slug: 'deal', label: 'Deal', schema: null },
  ]).returning();
  const [f, p, d] = await db.insert(businessObjectSchema).values([
    { orgId: ORG, typeId: request!.id, title: 'Northwind can export a report' },
    { orgId: ORG, typeId: planType!.id, title: 'Plan: export' },
    { orgId: ORG, typeId: dealType!.id, title: 'Kestrel Capital renewal' },
  ]).returning();
  feature = f!.id;
  plan = p!.id;
  deal = d!.id;
  const [r] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'eng', kind: 'build', status: 'done' }).returning();
  run = r!.id;
  const [a] = await db.insert(askSchema).values({ orgId: ORG, kind: 'decision', title: 'Ship it?' }).returning();
  ask = a!.id;
});

describe('typeCodesForOrg', () => {
  it('reads stored codes and derives the rest', async () => {
    const codes = await typeCodesForOrg(ORG);

    expect(codes.get('request')).toBe('FE');
    expect(codes.get('architecture_plan')).toBe('PL');
    expect(codes.get('deal')).toBe('DEAL');
  });
});

describe('resolveCode', () => {
  it('resolves a record by its code, any case, and an old bare #id', async () => {
    expect(await resolveCode(ORG, `FE-${feature}`)).toMatchObject({ kind: 'record', id: feature, typeSlug: 'request', code: `FE-${feature}` });
    expect(await resolveCode(ORG, `fe-${feature}`)).toMatchObject({ kind: 'record', id: feature });
    expect(await resolveCode(ORG, `#${plan}`)).toMatchObject({ kind: 'record', code: `PL-${plan}` });
    expect(await resolveCode(ORG, `DEAL-${deal}`)).toMatchObject({ kind: 'record', typeSlug: 'deal' });
  });

  it('refuses a code whose prefix is not the record\'s type, and says what its code is', async () => {
    const res = await resolveCode(ORG, `FE-${plan}`);

    expect(res.kind).toBe('none');
    expect((res as { reason: string }).reason).toContain(`is PL-${plan}`);
  });

  it('resolves core nouns, within the org only', async () => {
    expect(await resolveCode(ORG, `RUN-${run}`)).toEqual({ kind: 'run', id: run, code: `RUN-${run}` });
    expect(await resolveCode(ORG, `ask-${ask}`)).toEqual({ kind: 'ask', id: ask, code: `ASK-${ask}` });
    expect((await resolveCode(OTHER, `RUN-${run}`)).kind).toBe('none');
    expect((await resolveCode(OTHER, `FE-${feature}`)).kind).toBe('none');
  });

  it('says why when the text is not a code', async () => {
    expect(await resolveCode(ORG, 'the export plan')).toMatchObject({ kind: 'none' });
  });
});

describe('codeForRecord', () => {
  it('writes a record\'s code from its id', async () => {
    expect(await codeForRecord(ORG, feature)).toBe(`FE-${feature}`);
    expect(await codeForRecord(OTHER, feature)).toBeNull();
  });
});
