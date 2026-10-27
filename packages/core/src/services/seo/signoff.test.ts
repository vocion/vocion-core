import type { Ask } from '@/services/AskService';
import { describe, expect, it } from 'vitest';
import { gatePageOf, modelsLine } from './records';
import { parseSeoSignoffRef, seoSignoffRef, signoffPatch } from './signoff';

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

  it('reads feedback as filed only when every note says where it went', () => {
    const sent = { ...meta, status: 'changes_requested' as const, feedback: [{ at: '', by: 'usr-mara', note: 'a', filedTo: 'wiki:seo-playbook' }, { at: '', by: 'usr-mara', note: 'b', filedTo: null }] };

    expect(gatePageOf({ id: 7, title: 't', meta: sent })).toMatchObject({ changesRequested: true, feedbackFiled: false });
  });

  it('says which model ran each step, and when it is only the configured one', () => {
    expect(modelsLine({ plan: { id: 'claude-opus-5-5', name: 'Opus 5.5', source: 'ledger', agent: null, at: '' }, review: { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', source: 'configured', agent: null, at: '' } })).toBe('Plan Opus 5.5 · Review Sonnet 5.5 (configured)');
    expect(modelsLine(undefined)).toBeUndefined();
  });
});
