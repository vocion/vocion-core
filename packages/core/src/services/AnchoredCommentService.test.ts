import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { anchoredCommentSchema, leadBriefSchema } = await import('@/models/Schema');
const { buildAnchor } = await import('@/libs/anchors/resolve');
const {
  createComment,
  listComments,
  markApplied,
  resolveComments,
} = await import('@/services/AnchoredCommentService');

const ORG = 'org_anchor_test';
const TARGET = 'lead_brief:412';
const BODY = 'The angle rests on two sourced facts. The weakest point is the unverified email address.';
const FIELD = 'Recommended angle';

async function seedComment(note = 'soften this', quote = 'two sourced facts') {
  const start = BODY.indexOf(quote);
  return createComment({
    orgId: ORG,
    targetRef: TARGET,
    field: FIELD,
    anchor: buildAnchor(BODY, start, start + quote.length)!,
    note,
    createdBy: 'user_v',
  });
}

beforeEach(async () => {
  await db.delete(anchoredCommentSchema);
  await db.delete(leadBriefSchema);
});

afterAll(async () => {
  await db.delete(anchoredCommentSchema);
  await db.delete(leadBriefSchema);
});

describe('AnchoredCommentService', () => {
  it('a comment persists and comes back resolved against the live text', async () => {
    await seedComment();

    const rows = await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' });
    const resolved = await resolveComments(rows, { [FIELD]: BODY });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.note).toBe('soften this');
    expect(resolved[0]!.status).toBe('open');
    expect(BODY.slice(resolved[0]!.range!.start, resolved[0]!.range!.end)).toBe('two sourced facts');
  });

  it('comments are per user — another reviewer never sees them', async () => {
    await seedComment();

    const theirs = await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_a' });

    expect(theirs).toHaveLength(0);
  });

  it('an anchor survives an edit elsewhere in the field', async () => {
    await seedComment('check this', 'unverified email address');
    const edited = BODY.replace('The angle rests on two sourced facts.', 'The angle now rests on three facts.');

    const rows = await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' });
    const resolved = await resolveComments(rows, { [FIELD]: edited });

    expect(edited.slice(resolved[0]!.range!.start, resolved[0]!.range!.end)).toBe('unverified email address');
    expect(resolved[0]!.status).toBe('open');
  });

  it('an edit inside the span orphans the comment, and the orphaning is recorded', async () => {
    const created = await seedComment();
    const rewritten = BODY.replace('two sourced facts', 'three sourced facts');

    const resolved = await resolveComments(
      await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' }),
      { [FIELD]: rewritten },
    );

    expect(resolved[0]!.range).toBeNull();
    expect(resolved[0]!.status).toBe('orphaned');

    // Persisted, not just computed for this render.
    const reread = await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' });

    expect(reread.find(r => r.id === created.id)!.status).toBe('orphaned');
  });

  it('a field we were not given never orphans a comment — absent is not missing', async () => {
    const created = await seedComment();

    // A caller that has not rendered the document yet sends no field text.
    const resolved = await resolveComments(
      await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' }),
      {},
    );

    expect(resolved[0]!.range).toBeNull();
    expect(resolved[0]!.status).toBe('open');
    const reread = await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' });
    expect(reread.find(r => r.id === created.id)!.status).toBe('open');
  });

  it('applied is only ever set explicitly, and carries the run that did it', async () => {
    const created = await seedComment();

    const [applied] = await markApplied({ orgId: ORG, ids: [created.id], runId: 77 });

    expect(applied!.status).toBe('applied');
    expect(applied!.appliedAt).toBeInstanceOf(Date);
    expect(applied!.appliedByRunId).toBe(77);
  });

  it('the comment layer never mutates the document it comments on', async () => {
    const [lead] = await db.insert(leadBriefSchema).values({
      orgId: ORG,
      contactRef: 'contacts:412',
      contactName: 'Pete Laverick',
      triggerType: 'new',
      sections: [{ heading: FIELD, body: BODY }],
    }).returning();

    const created = await seedComment();
    await markApplied({ orgId: ORG, ids: [created.id], runId: 77 });
    await resolveComments(
      await listComments({ orgId: ORG, targetRef: TARGET, createdBy: 'user_v' }),
      { [FIELD]: BODY.replace('two sourced facts', 'three sourced facts') },
    );

    const [after] = await db.select().from(leadBriefSchema);

    expect(after!.sections).toEqual(lead!.sections);
  });
});
