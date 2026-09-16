import { describe, expect, it } from 'vitest';
import { changeRef, contextTagRefs, hasChangeIntent, insertTagAt, matchesTag, tagSlug } from './composerTags';

const LABELS = { artifact: 'Artifact', page: 'This page', change: 'Change the draft' };

describe('contextTagRefs', () => {
  it('always offers the artifact contract, first — it is the one tag that changes what the turn produces', () => {
    expect(contextTagRefs(null, LABELS)).toEqual([{ type: 'deliverable', id: 'artifact', label: 'Artifact' }]);
  });

  it('adds the page, and the record the page is about', () => {
    const refs = contextTagRefs({
      path: '/dashboard/deals/12',
      title: 'Acme renewal',
      record: { type: 'deal', id: '12', label: 'Acme renewal' },
    }, LABELS);

    expect(refs.map(r => r.type)).toEqual(['deliverable', 'page', 'deal']);
    expect(refs[1]).toEqual({ type: 'page', id: '/dashboard/deals/12', label: 'Acme renewal' });
  });

  it('falls back to the label when a page has no title', () => {
    expect(contextTagRefs({ path: '/dashboard', title: '  ' }, LABELS)[1]).toEqual({ type: 'page', id: '/dashboard', label: 'This page' });
  });

  it('bends a record type the composer cannot chip into `object` rather than dropping it', () => {
    const refs = contextTagRefs({
      path: '/dashboard/artifacts/9',
      title: 'Pipeline report',
      record: { type: 'artifact', id: '9', label: 'Pipeline report' },
    }, LABELS);

    expect(refs[2]).toEqual({ type: 'object', id: '9', label: 'Pipeline report' });
  });
});

describe('tagSlug', () => {
  it('fixes the two tags that name a role rather than a record', () => {
    expect(tagSlug({ type: 'deliverable', id: 'artifact', label: 'Document' })).toBe('artifact');
    expect(tagSlug({ type: 'page', id: '/dashboard/deals/12', label: 'Acme renewal' })).toBe('page');
  });

  it('slugs everything else off its id, which is what somebody would type', () => {
    expect(tagSlug({ type: 'agent', id: 'pipeline-analyst', label: 'Pipeline Analyst' })).toBe('pipeline-analyst');
    expect(tagSlug({ type: 'object', id: 'contacts:9412', label: 'Dana Wu' })).toBe('9412');
    expect(tagSlug({ type: 'mission', id: '', label: 'Q3 Renewals' })).toBe('q3-renewals');
  });
});

describe('matchesTag', () => {
  const artifact = { type: 'deliverable' as const, id: 'artifact', label: 'Document' };
  const pageRef = { type: 'page' as const, id: '/dashboard/deals/12', label: 'Acme renewal' };

  it('matches on the slug, so `@art` finds the artifact tag whatever it is called', () => {
    expect(matchesTag(artifact, 'art')).toBe(true);
    expect(matchesTag(artifact, 'doc')).toBe(true);
    expect(matchesTag(artifact, 'team')).toBe(false);
  });

  it('finds the page by the word `page`, which its label and path never contain', () => {
    expect(matchesTag(pageRef, 'page')).toBe(true);
    expect(matchesTag(pageRef, 'acme')).toBe(true);
  });

  it('an empty query offers everything', () => {
    expect(matchesTag(artifact, '')).toBe(true);
  });
});

describe('insertTagAt', () => {
  it('splices the tag at the caret and reports where the caret lands', () => {
    expect(insertTagAt('summarise this', 9, 'artifact')).toEqual({ value: 'summarise @artifact this', caret: 19 });
  });

  it('needs no leading space at the start of a line, or after one', () => {
    expect(insertTagAt('', 0, 'artifact')).toEqual({ value: '@artifact', caret: 9 });
    expect(insertTagAt('draft ', 6, 'artifact')).toEqual({ value: 'draft @artifact', caret: 15 });
  });

  it('clamps a caret that is off the end of the draft', () => {
    expect(insertTagAt('hi', 99, 'page')).toEqual({ value: 'hi @page', caret: 8 });
    expect(insertTagAt('hi', -4, 'page')).toEqual({ value: '@pagehi', caret: 5 });
  });
});

describe('the change intent', () => {
  it('is offered only where a sequence draft is in view — a menu entry that cannot act is a menu entry that lies', () => {
    const without = contextTagRefs({ path: '/gtm/lead/1', title: 'Lead' }, LABELS);
    const with_ = contextTagRefs({ path: '/gtm/lead/1', title: 'Lead' }, LABELS, { change: true });

    expect(without.map(r => r.type)).toEqual(['deliverable', 'page']);
    expect(with_.map(r => r.type)).toEqual(['deliverable', 'intent', 'page']);
  });

  it('types as `@change` and reads back off the message', () => {
    expect(tagSlug(changeRef())).toBe('change');
    expect(matchesTag(changeRef(), 'chan')).toBe(true);
    expect(hasChangeIntent([changeRef()])).toBe(true);
    expect(hasChangeIntent([{ type: 'deliverable', id: 'artifact' }])).toBe(false);
  });
});
