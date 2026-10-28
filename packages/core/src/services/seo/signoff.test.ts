import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { personOnlyRefusal } from '@/libs/actions/objects-update-meta';
import { checkPageMeta } from './meta';
import { modelOfToolCall, runCallFor, seatOf } from './modelThatRan';
import { gatePageOf, modelsLine, signedOff } from './records';
import { parseSeoPlanRef, parseSeoSignoffRef, planPatch, planTable, seoPlanRef, seoSignoffRef, signoffPatch } from './signoff';

const NOW = new Date('2026-10-27T15:00:00Z');
const ask = (decision: string, note: string | null = null, extra: Partial<Ask> = {}) => ({ id: 41, status: decision === 'approve' ? 'approved' : 'done', decision, decisionNote: note, decidedBy: 'usr-mara', sourceRef: seoSignoffRef(7, 90, 1), ...extra }) as Ask;
const page = { draftArtifactId: 90, draftRound: 1, feedback: [], status: 'in_review' as const };

describe('the sign-off ref', () => {
  it('names the page, the draft and its round, and reads back', () => {
    expect(seoSignoffRef(7, 90, 2)).toBe('seo-page:7:90:2');
    expect(parseSeoSignoffRef('seo-page:7:90:2')).toEqual({ pageId: 7, draftArtifactId: 90, round: 2 });
    expect(parseSeoSignoffRef('routine-run:7:1')).toBeNull();
    expect(parseSeoSignoffRef(null)).toBeNull();
  });
});

describe('what an answered sign-off does to a page', () => {
  it('approve: approved, signed by the person, for this draft', () => {
    expect(signoffPatch(ask('approve'), page, NOW)).toMatchObject({ status: 'approved', signoff: { decision: 'approve', by: 'usr-mara', askId: 41, draftArtifactId: 90, round: 1 } });
  });

  it('revise with a note: changes requested, and the note is on the page, not yet filed', () => {
    const patch = signoffPatch(ask('other', 'Shorter intro.'), page, NOW)!;

    expect(patch.status).toBe('changes_requested');
    expect(patch.feedback).toEqual([{ at: NOW.toISOString(), by: 'usr-mara', note: 'Shorter intro.', filedTo: null, askId: 41, draftArtifactId: 90 }]);
  });

  it('discard: the page leaves the batch', () => {
    expect(signoffPatch(ask('reject'), page, NOW)?.status).toBe('rejected');
  });

  it('changes nothing for a skipped ask or an answer about an older draft', () => {
    expect(signoffPatch(ask('approve', null, { status: 'skipped' } as Partial<Ask>), page, NOW)).toBeNull();
    expect(signoffPatch(ask('approve'), { ...page, draftRound: 2 }, NOW)).toBeNull();
    expect(signoffPatch(ask('approve'), { ...page, draftArtifactId: 91 }, NOW)).toBeNull();
  });
});

describe('what the gate reads off a page', () => {
  const meta = { projectId: 1, batchId: 2, order: 1, keyword: 'trail shoes', status: 'approved' as const, draftArtifactId: 90, draftRound: 1 };

  it('counts approval only from a person\'s sign-off on the current draft', () => {
    expect(gatePageOf({ id: 7, title: 't', meta }).approved).toBe(false);
    expect(gatePageOf({ id: 7, title: 't', meta: { ...meta, signoff: { decision: 'approve', by: 'agent:seo-editor', at: '', askId: 1, draftArtifactId: 90, round: 1 } } }).approved).toBe(false);
    expect(gatePageOf({ id: 7, title: 't', meta: { ...meta, signoff: { decision: 'approve', by: 'usr-mara', at: '', askId: 1, draftArtifactId: 90, round: 1 } } }).approved).toBe(true);
  });

  it('a draft the editor sent back is the writer\'s to redraft, not one waiting on a person', () => {
    expect(gatePageOf({ id: 7, title: 't', meta: { ...meta, status: 'drafting' } }).written).toBe(false);
    expect(gatePageOf({ id: 7, title: 't', meta: { ...meta, status: 'in_review' } }).written).toBe(true);
  });

  it('reads feedback as filed only when every note says where it went', () => {
    const sent = { ...meta, status: 'changes_requested' as const, feedback: [{ at: '', by: 'usr-mara', note: 'a', filedTo: 'project:1', filedText: 'a' }, { at: '', by: 'usr-mara', note: 'b', filedTo: null }] };

    expect(gatePageOf({ id: 7, title: 't', meta: sent })).toMatchObject({ changesRequested: true, feedbackFiled: false });
  });

  it('says which model ran each step, and when it is only the configured one', () => {
    expect(modelsLine({ plan: { id: 'claude-opus-5-5', name: 'Opus 5.5', source: 'ledger', agent: null, at: '' }, review: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', source: 'configured', agent: null, at: '' } })).toBe('Plan Opus 5.5 · Review Sonnet 5.5 (configured)');
    expect(modelsLine(undefined)).toBeUndefined();
  });
});

describe('a sign-off is bound to the words it was given on', () => {
  const words = { version: 3, hash: 'aaa' };
  const meta = { draftArtifactId: 90, draftRound: 1, signoff: { decision: 'approve' as const, by: 'usr-mara', at: '', askId: 1, draftArtifactId: 90, round: 1, version: 3, hash: 'aaa' } };

  it('records the version and hash the ask showed', () => {
    const patch = signoffPatch(ask('approve'), { ...page, signoffAsk: { askId: 41, round: 1, draftArtifactId: 90, version: 3, hash: 'aaa', at: '' } }, NOW)!;

    expect(patch.signoff).toMatchObject({ version: 3, hash: 'aaa' });
  });

  it('counts while the words are the ones signed, and stops counting the moment they change', () => {
    expect(signedOff(meta, words)).toBe(true);
    expect(signedOff(meta, { version: 4, hash: 'bbb' })).toBe(false);
    // A collapsed edit keeps the version number but not the hash.
    expect(signedOff(meta, { version: 3, hash: 'bbb' })).toBe(false);
    expect(gatePageOf({ id: 7, title: 't', meta: { projectId: 1, batchId: 2, order: 1, keyword: 'k', status: 'approved', ...meta } }, { words: new Map([[90, { version: 4, hash: 'bbb' }]]) }).approved).toBe(false);
  });
});

describe('the keyword plan\'s sign-off', () => {
  const plan = (decision: string, note: string | null = null) => ({ id: 51, status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'done', decision, decisionNote: note, decidedBy: 'usr-mara', sourceRef: seoPlanRef(12, 2) }) as Ask;

  it('names the batch and the plan round', () => {
    expect(parseSeoPlanRef('seo-plan:12:2')).toEqual({ batchId: 12, round: 2 });
    expect(parseSeoPlanRef('seo-page:1:2:3')).toBeNull();
  });

  it('approve releases it; revise holds it with the note; an older round moves nothing', () => {
    expect(planPatch(plan('approve'), { plan: { state: 'plan_review', round: 2 } }, NOW)?.plan).toMatchObject({ state: 'approved', askId: 51 });
    expect(planPatch(plan('other', 'Drop the blog posts.'), { plan: { state: 'plan_review', round: 2 } }, NOW)?.plan).toMatchObject({ state: 'revise', note: 'Drop the blog posts.' });
    expect(planPatch(plan('approve'), { plan: { state: 'plan_review', round: 3 } }, NOW)).toBeNull();
  });

  it('shows the keyword map a person signs off', () => {
    const table = planTable([{ keyword: 'boiler repair', pageType: 'location', location: 'Riverton', intent: 'transactional', cluster: 'boilers', target: 'refresh https://northwind-home.example/boilers' }]);

    expect(table).toContain('| Keyword | Page type | Location | Intent | Cluster | Target |');
    expect(table).toContain('| 1 | boiler repair | location | Riverton | transactional | boilers | refresh https://northwind-home.example/boilers |');
  });
});

describe('a page\'s meta, checked in code', () => {
  it('passes good meta, and says when a title is close to the limit', () => {
    const ok = checkPageMeta({ metaTitle: 'Boiler repair in Riverton', metaDescription: 'Same-day boiler repair.', slug: 'boiler-repair-riverton' });

    expect(ok.value).toEqual({ metaTitle: 'Boiler repair in Riverton', metaDescription: 'Same-day boiler repair.', slug: 'boiler-repair-riverton' });
    expect(checkPageMeta({ metaTitle: 'x'.repeat(56), metaDescription: 'd', slug: 's' }).warnings[0]).toContain('56 characters');
  });

  it('refuses a long title or description, a slug that is not kebab-case, and a slug the project already uses', () => {
    const bad = checkPageMeta({ metaTitle: 'x'.repeat(61), metaDescription: 'y'.repeat(156), slug: 'Boiler_Repair' });

    expect(bad.value).toBeNull();
    expect(bad.problems).toEqual([
      'meta_title is 61 characters; at most 60',
      'meta_description is 156 characters; at most 155',
      'slug "Boiler_Repair" is not kebab-case (lowercase words joined by hyphens, e.g. trail-running-shoes)',
    ]);
    expect(checkPageMeta({ metaTitle: 't', metaDescription: 'd', slug: 'taken' }, {}, new Set(['/taken'])).problems).toEqual(['slug "taken" is already used by another page of this project']);
  });

  it('a redraft keeps the page\'s meta when it names none', () => {
    expect(checkPageMeta({}, { metaTitle: 't', metaDescription: 'd', slug: 's' }).value).toEqual({ metaTitle: 't', metaDescription: 'd', slug: 's' });
  });
});

describe('the model stamped on a step is the call that made it', () => {
  it('reads the model off the message that made this tool call, and the teammate that ran it', () => {
    const runtime = {
      toolCallId: 'call_2',
      metadata: { lc_agent_name: 'seo-writer' },
      state: { messages: [
        { tool_calls: [{ id: 'call_1' }], response_metadata: { model_name: 'claude-haiku-4-5' } },
        { tool_calls: [{ id: 'call_2' }], response_metadata: { model_name: 'claude-opus-5-5' } },
      ] },
    };

    expect(modelOfToolCall(runtime)).toBe('claude-opus-5-5');
    expect(seatOf({ agentSlug: 'seo-strategist' }, runtime)).toBe('seo-writer');
    expect(seatOf({ agentSlug: 'seo-strategist' }, {})).toBe('seo-strategist');
    expect(modelOfToolCall({ toolCallId: 'call_9', state: runtime.state })).toBeNull();
  });
});

describe('a project\'s gate and publish targets are a person\'s', () => {
  it('refuses an agent\'s write to either, and lets every other field through', () => {
    expect(personOnlyRefusal('data_room', { seoGate: { sample: 100, tranche: 100 } })).toContain('set by a person on the project page');
    expect(personOnlyRefusal('data_room', { publishTargets: [] })).toContain('publishTargets');
    expect(personOnlyRefusal('data_room', { notes: 'x' })).toBeUndefined();
    expect(personOnlyRefusal('request', { seoGate: 1 })).toBeUndefined();
  });
});

describe('a background run is stamped from its own calls', () => {
  // Newest first, as the ledger is read for the run.
  const rows = [
    { model: 'claude-sonnet-5-5', agent: 'seo-editor' },
    { model: 'claude-opus-5-5-20261001', agent: 'seo-strategist' },
    { model: 'claude-haiku-4-5-20251001', agent: 'seo-strategist' },
  ];

  it('the seat\'s own row first', () => {
    expect(runCallFor(rows, 'seo-editor', 'seo-strategist', 'claude-sonnet-5-5')?.model).toBe('claude-sonnet-5-5');
  });

  it('a teammate whose calls were filed under the lead: the run\'s call on its own model, never the newest of the run', () => {
    expect(runCallFor(rows, 'seo-writer', 'seo-strategist', 'claude-opus-5-5')?.model).toBe('claude-opus-5-5-20261001');
    expect(runCallFor(rows, 'seo-writer', 'seo-strategist', 'claude-opus-4-1')).toBeNull();
  });

  it('the lead: the run\'s newest call of its own', () => {
    expect(runCallFor(rows, 'seo-strategist', 'seo-strategist', null)?.model).toBe('claude-opus-5-5-20261001');
    expect(runCallFor([], 'seo-strategist', 'seo-strategist', null)).toBeNull();
  });
});
