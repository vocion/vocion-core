/**
 * A picture rides with the turns until the agent answers it (FE-535,
 * 2026-10-26: a screenshot came with a turn that ended without answering, and
 * the next turn said it had no access to the image).
 */
import type { ArtifactRow } from '@/services/ArtifactService';
import { describe, expect, it } from 'vitest';
import { unansweredImages } from './attachments';

const file = (id: number, contentType: string) => ({ id, title: `file-${id}`, kind: 'file', spec: { contentType } }) as unknown as ArtifactRow;

describe('unansweredImages', () => {
  const uploads = new Map<number, ArtifactRow[]>([
    [1, [file(10, 'image/png')]],
    [3, [file(11, 'image/png'), file(12, 'application/pdf')]],
    [5, [file(13, 'image/jpeg')]],
  ]);

  it('carries the images since the last answered turn, not the ones before it, nor documents', () => {
    const msgs = [
      { id: 1, role: 'user', content: 'old one' },
      { id: 2, role: 'assistant', content: 'Answered.', status: 'complete' },
      { id: 3, role: 'user', content: 'fix this badge' },
      { id: 4, role: 'assistant', content: '', status: 'stalled' },
      { id: 5, role: 'user', content: 'and this' },
    ];

    expect(unansweredImages(msgs, uploads, new Set(), 10).map(r => r.id)).toEqual([11, 13]);
  });

  it('a stalled turn with words did not answer either; an answered turn ends the carry', () => {
    const stalled = [{ id: 3, role: 'user', content: 'x' }, { id: 4, role: 'assistant', content: 'Looking…', status: 'stalled' }];
    const answered = [{ id: 3, role: 'user', content: 'x' }, { id: 4, role: 'assistant', content: 'Here it is.', status: 'complete' }];

    expect(unansweredImages(stalled, uploads, new Set(), 10).map(r => r.id)).toEqual([11]);
    expect(unansweredImages(answered, uploads, new Set(), 10)).toEqual([]);
  });

  it('skips what the turn already has, and never passes the limit', () => {
    const msgs = [{ id: 3, role: 'user', content: 'x' }, { id: 5, role: 'user', content: 'y' }];

    expect(unansweredImages(msgs, uploads, new Set([11]), 10).map(r => r.id)).toEqual([13]);
    expect(unansweredImages(msgs, uploads, new Set([99]), 2).map(r => r.id)).toEqual([11]);
  });
});
