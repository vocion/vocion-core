import type { RuntimeContext } from '@/services/agents/types';
/**
 * The Prompts register end to end on PGlite through the strategist's tools:
 * proposed prompts are saved in code, one row per prompt however often it is
 * saved; a Brand Radar export dropped in chat is imported onto the same rows
 * with what it says about mentions; drop and restore; and the export written
 * as a file reads back to the same prompts. Every brand here is fictional.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
const saved: Record<string, string> = {};
vi.mock('@/libs/tools/artifacts/store', () => ({
  saveArtifact: vi.fn(async ({ data, ext }: { data: string; ext: string }) => {
    saved[ext] = data;
    return { filename: `x.${ext}`, url: `/api/artifacts/x.${ext}`, bytes: data.length };
  }),
}));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom } = await import('@/services/DataRoomService');
const { createArtifact } = await import('@/services/ArtifactService');
const { seoPromptTools } = await import('@/services/agents/tools/seoPrompts');
const { listProjectPrompts, parseBrandRadarCsv } = await import('./prompts');

const ORG = 'proj_seo_prompts_brightline';
let projectId = 0;
const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', conversationId: undefined, harnessConfig: {}, emit: () => {} } as unknown as RuntimeContext;
const call = (name: string, args: Record<string, unknown>) => (seoPromptTools(ctx).find(t => t.name === name)!.invoke as (a: unknown) => Promise<unknown>)(args).then(String);

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-prompts', name: 'Brightline Studio', slug: 'brightline-prompts' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-prompts', slug: 'brightline-prompts', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });

  expect((await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' })).errors).toEqual([]);

  projectId = (await createDataRoom(ORG, 'usr-mara', { title: 'Tally Books', client: 'Tally Books', domains: ['tally-books.example'] })).id;
});

describe('the Prompts register', () => {
  it('keeps the prompts the strategist proposes, one row each however often they are saved', async () => {
    const prompts = [
      { prompt: 'best invoicing tool for agencies', group: 'category', platforms: ['chatgpt', 'perplexity'], why: 'where buyers start' },
      { prompt: 'Tally Books vs Ledgerly', group: 'comparison' },
    ];

    expect(await call('seo_save_prompts', { project_id: projectId, prompts })).toMatch(/Saved 2 prompts to Tally Books's register \(2 new, 0 already there\)/);
    expect(await call('seo_save_prompts', { project_id: projectId, prompts: [{ prompt: 'Best invoicing tool for agencies?', group: 'category', platforms: ['google_ai_overviews'] }] })).toMatch(/\(0 new, 1 already there\)/);

    const rows = await listProjectPrompts(ORG, projectId);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.meta).toMatchObject({ prompt: 'best invoicing tool for agencies', group: 'category', platforms: ['chatgpt', 'perplexity', 'google_ai_overviews'], source: 'agent', status: 'tracked', visibility: 'unchecked', why: { text: 'where buyers start', by: 'agent:seo-strategist' } });
    // The strategist proposed them in the person's chat: its act, not the person's.
  });

  it('imports a Brand Radar export dropped in chat onto the same rows, naming what it read', async () => {
    const csv = 'Prompt,Platform,Mentioned,Cited,Competitors,Date\nbest invoicing tool for agencies,ChatGPT,yes,no,Ledgerly,2026-10-20\nhow do I stop chasing late payments,Perplexity,no,no,"Ledgerly, Billstream",2026-10-20\n';
    const { artifact } = await createArtifact({ orgId: ORG, kind: 'file', title: 'brand-radar.csv', spec: { filename: 'b.csv', originalName: 'brand-radar.csv', contentType: 'text/csv', bytes: csv.length, url: '/api/artifacts/x/b.csv', text: csv }, author: { kind: 'human', id: 'usr-mara' } });

    const out = await call('seo_import_prompts', { project_id: projectId, artifact_id: artifact.id });

    expect(out).toMatch(/Imported 2 prompts into Tally Books's register \(1 new, 1 refreshed\)/);
    expect(out).toMatch(/"Prompt" as prompt, "Platform" as platform, "Mentioned" as mentioned/);
    expect(out).toMatch(/mentioned or cited on 1 of them/);

    const rows = await listProjectPrompts(ORG, projectId);
    const best = rows.find(r => r.meta.promptKey === 'best invoicing tool for agencies')!;

    expect(rows).toHaveLength(3);
    expect(best.meta).toMatchObject({ source: 'agent', mentioned: true, cited: false, visibility: 'mentioned', competitorsMentioned: ['Ledgerly'], checkedAt: '2026-10-20T00:00:00.000Z', checkedWith: 'Ahrefs Brand Radar export' });
    expect(rows.find(r => r.meta.promptKey.startsWith('how do i'))!.meta).toMatchObject({ source: 'imported', visibility: 'absent', competitorsMentioned: ['Ledgerly', 'Billstream'] });
  });

  it('drops a prompt with why, leaves it out of the export, and restores it', async () => {
    const vs = (await listProjectPrompts(ORG, projectId)).find(r => r.meta.group === 'comparison')!;

    expect(await call('seo_save_prompts', { project_id: projectId, drop_ids: [vs.id], why: 'the client will not compare by name' })).toMatch(/dropped/);
    expect(await call('seo_list_prompts', { project_id: projectId })).not.toContain('Tally Books vs Ledgerly');
    expect(await call('seo_export_prompts', { project_id: projectId })).toMatch(/Exported 2 prompts for Tally Books as Tally Books - AI prompts\.csv/);
    expect(await call('seo_save_prompts', { project_id: projectId, restore_ids: [vs.id] })).toMatch(/tracked/);
  });

  it('exports a CSV that reads back to the register', async () => {
    await call('seo_export_prompts', { project_id: projectId });
    const back = parseBrandRadarCsv(saved.csv!, '2026-10-29T00:00:00.000Z').prompts;
    const rows = await listProjectPrompts(ORG, projectId);

    expect(back.map(p => p.prompt).sort()).toEqual(rows.map(r => r.meta.prompt).sort());
    expect(back.find(p => p.prompt === 'best invoicing tool for agencies')).toMatchObject({ group: 'category', platforms: ['chatgpt', 'perplexity', 'google_ai_overviews'], mentioned: true, cited: false, competitorsMentioned: ['Ledgerly'] });
  });
});
