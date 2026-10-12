/**
 * Reading a reviewer's field corrections for learnings.
 *
 * What can go wrong here is mostly what counts as a correction. Calling a
 * reordered list or a blank-for-null swap a correction teaches the agent
 * something nobody said; missing a real one loses the only evidence a
 * reviewer who typed nothing ever leaves. The model call is mocked: these pin
 * what it is shown and which of its answers survive, never what it decides.
 */
import { HumanMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const warnMock = vi.fn();

vi.mock('@/libs/llm', () => ({
  buildChatModel: () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }),
}));

// Tracing is a no-op here: left real it would try to reach a local Langfuse.
vi.mock('@/libs/Langfuse', () => ({
  cleanUsageDetails: (details: unknown) => details,
  traceFor: () => ({
    update: () => {},
    generation: () => ({ end: () => {} }),
  }),
}));

// Charging writes to the budget ledger; nothing here has a database.
vi.mock('@/services/budget/chargeModelCall', () => ({
  chargeModelCall: async () => {},
}));

vi.mock('@/libs/Logger', () => ({
  logger: { warn: (...args: unknown[]) => warnMock(...args), info: () => {}, error: () => {} },
}));

const { changedExcerpts, describeFieldEdit, describeProposedRecord, fieldEdits, MAX_FIELD_EDITS, proposeEditLearnings, readFieldEdits }
  = await import('@/services/feedback/editLearning');

/** About 3,000 characters a reviewer left alone, ahead of the sentence they fixed. */
const LONG_OPENING = 'Doors open early for the brunch set at Pier Hall. '.repeat(60);
const LONG_BEFORE = `${LONG_OPENING}Tickets are $15 at the door.`;
const LONG_AFTER = `${LONG_OPENING}Tickets are free with a brunch order.`;

/** The user message the last model call was sent. */
function sentUserMessage(): string {
  const messages = invokeMock.mock.calls.at(-1)?.[0] as unknown[];
  const human = messages.find(message => message instanceof HumanMessage) as HumanMessage;
  return String(human.content);
}

/**
 * Make the model answer with this JSON.
 * @param reply - The reply body.
 */
function modelReplies(reply: unknown): void {
  invokeMock.mockResolvedValue({ content: typeof reply === 'string' ? reply : JSON.stringify(reply) });
}

const CATEGORY_EDIT = {
  field: 'categories',
  before: ['Live Music', 'Jazz Brunch'],
  after: ['Live Music', 'Food & Drink'],
};

beforeEach(() => {
  invokeMock.mockReset();
  warnMock.mockReset();
});

describe('fieldEdits', () => {
  it('reports a changed value and a changed list with both sides', () => {
    expect(
      fieldEdits(
        { title: 'Harbor Jazz', categories: ['Live Music', 'Jazz Brunch'], start: '2099-06-01T19:00' },
        { title: 'Harbor Jazz Night', categories: ['Live Music', 'Food & Drink'], start: '2099-06-01T19:00' },
      ),
    ).toEqual([
      { field: 'title', before: 'Harbor Jazz', after: 'Harbor Jazz Night' },
      { field: 'categories', before: ['Live Music', 'Jazz Brunch'], after: ['Live Music', 'Food & Drink'] },
    ]);
  });

  it('does not call a reordered list, a blank for a null, or padding a correction', () => {
    expect(
      fieldEdits(
        { categories: ['Kids', 'Live Music'], price: null, title: 'Harbor Jazz', venue: { city: 'Lakeport', name: 'Pier Hall' } },
        { categories: ['Live Music', 'Kids'], price: '', title: '  Harbor Jazz ', venue: { name: 'Pier Hall', city: 'Lakeport' } },
      ),
    ).toEqual([]);
  });

  it('treats a field the approved payload never mentions as untouched, not cleared', () => {
    expect(fieldEdits({ title: 'Harbor Jazz', price: '$10' }, { title: 'Harbor Jazz' })).toEqual([]);
  });

  it('keeps the part of a long text the reviewer changed, not its unchanged opening', () => {
    const [edit] = fieldEdits({ description: LONG_BEFORE }, { description: LONG_AFTER });

    expect(String(edit!.before)).toContain('Tickets are $15 at the door.');
    expect(String(edit!.after)).toContain('Tickets are free with a brunch order.');
    expect(String(edit!.after).length).toBeLessThanOrEqual(2_000);
  });

  it('keeps the opening of a long text filled in where there was none, up to what the model reads', () => {
    const [edit] = fieldEdits({ body: null }, { body: `  ${'w'.repeat(3_000)}  ` });

    expect(String(edit!.after)).toHaveLength(2_000);
    expect(String(edit!.after).startsWith('www')).toBe(true);
    expect(edit!.before).toBeNull();
  });

  it('reports a list the reviewer emptied, and a value they filled in', () => {
    expect(fieldEdits({ categories: ['Kids'], price: null }, { categories: [], price: 'Free' })).toEqual([
      { field: 'categories', before: ['Kids'], after: [] },
      { field: 'price', before: null, after: 'Free' },
    ]);
  });
});

describe('readFieldEdits', () => {
  it('accepts no list as no corrections', () => {
    expect(readFieldEdits(undefined)).toEqual({ edits: [] });
  });

  it('reads a missing side as empty and trims the field name', () => {
    expect(readFieldEdits([{ field: ' price ', after: 'Free' }])).toEqual({
      edits: [{ field: 'price', before: null, after: 'Free' }],
    });
  });

  it('refuses a list it cannot read, saying which entry', () => {
    expect(readFieldEdits({ field: 'price' })).toEqual({ error: expect.stringContaining('must be an array') });
    expect(readFieldEdits([{ field: 'price', after: 1 }, { before: 1 }])).toEqual({ error: expect.stringContaining('payload.edits[1]') });
  });

  it('refuses two corrections to one field, which would leave the model two answers', () => {
    expect(readFieldEdits([{ field: 'price', after: 'Free' }, { field: 'price ', after: '$5' }]))
      .toEqual({ error: expect.stringContaining('repeats the field "price"') });
  });

  it('accepts a long text from an outside app, cut to the part around the change', () => {
    const before = `${'Doors open early. '.repeat(4_000)}Tickets are $15.`;
    const after = `${'Doors open early. '.repeat(4_000)}Tickets are free.`;

    const read = readFieldEdits([{ field: 'description', before, after }]);

    expect(read).not.toHaveProperty('error');

    const [edit] = (read as { edits: Array<{ before: unknown; after: unknown }> }).edits;

    expect(String(edit!.before).endsWith('Tickets are $15.')).toBe(true);
    expect(String(edit!.after).endsWith('Tickets are free.')).toBe(true);
    expect(String(edit!.after).length).toBeLessThanOrEqual(2_000);
  });

  it('still refuses a list too large to be one correction, even after cutting text', () => {
    const tags = Array.from({ length: 300 }, (_, index) => `${index}-${'t'.repeat(1_000)}`);

    expect(readFieldEdits([{ field: 'tags', before: [], after: tags }]))
      .toEqual({ error: expect.stringContaining('larger than') });
  });

  it('refuses more corrections than a review makes', () => {
    const tooMany = Array.from({ length: MAX_FIELD_EDITS + 1 }, (_, index) => ({ field: `f${index}`, before: 1, after: 2 }));

    expect(readFieldEdits(tooMany)).toEqual({ error: expect.stringContaining(`${MAX_FIELD_EDITS + 1} corrections`) });
  });
});

describe('changedExcerpts', () => {
  it('returns texts that fit whole', () => {
    expect(changedExcerpts('Tickets are $15.', 'Tickets are free.')).toEqual(['Tickets are $15.', 'Tickets are free.']);
  });

  it('cuts both long texts from the same point just ahead of the first difference', () => {
    const [before, after] = changedExcerpts(LONG_BEFORE, LONG_AFTER);
    const lead = 'Doors open early for the brunch set at Pier Hall. ';

    // The cut is marked, and both sides start at the same unchanged context.
    expect(before.startsWith('...')).toBe(true);
    expect(after.slice(0, 120)).toBe(before.slice(0, 120));
    expect(before).toContain(lead.slice(10));
    expect(before.endsWith('Tickets are $15 at the door.')).toBe(true);
    expect(after.endsWith('Tickets are free with a brunch order.')).toBe(true);
  });

  it('shows text appended to a long value, with the end it was added to', () => {
    const [before, after] = changedExcerpts(LONG_OPENING.trim(), `${LONG_OPENING}Brunch from 11.`);

    expect(after.endsWith('Brunch from 11.')).toBe(true);
    expect(before.endsWith('at Pier Hall.')).toBe(true);
  });

  it('marks a cut at the end when the change comes early in a long text', () => {
    const [before, after] = changedExcerpts(`Brunch set. ${LONG_OPENING}`, `Jazz brunch set. ${LONG_OPENING}`);

    expect(before.startsWith('Brunch set.')).toBe(true);
    expect(after.startsWith('Jazz brunch set.')).toBe(true);
    expect(after.endsWith('...')).toBe(true);
    expect(after).toHaveLength(2_000);
  });
});

describe('describeFieldEdit', () => {
  it('quotes the part of a long text that changed', () => {
    const evidence = describeFieldEdit({ field: 'description', before: LONG_BEFORE, after: LONG_AFTER });

    expect(evidence).toContain('Tickets are $15 at the door.');
    expect(evidence).toContain('Tickets are free with a brunch order.');
  });

  it('reads a list as its items and an empty side as empty', () => {
    expect(describeFieldEdit({ field: 'categories', before: ['Kids'], after: [] })).toBe('Corrected categories: "Kids" became empty.');
    expect(describeFieldEdit(CATEGORY_EDIT)).toBe('Corrected categories: "Live Music, Jazz Brunch" became "Live Music, Food & Drink".');
  });
});

describe('describeProposedRecord', () => {
  it('lists the fields that have a value, then the agent\'s rationale', () => {
    expect(describeProposedRecord({ title: 'Harbor Jazz', price: null, categories: ['Live Music'] }, 'Listed on the venue calendar.'))
      .toBe('title: "Harbor Jazz"\ncategories: "Live Music"\nagent rationale: Listed on the venue calendar.');
  });
});

describe('proposeEditLearnings', () => {
  it('makes no model call when nothing was corrected', async () => {
    expect(await proposeEditLearnings({ edits: [] })).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('shows the model each correction, the note, and the rule the note already became', async () => {
    modelReplies({ learnings: [] });

    await proposeEditLearnings({
      edits: [CATEGORY_EDIT],
      note: 'Pier Hall brunches are food events.',
      noteRule: 'File brunch events at Pier Hall under Food & Drink.',
      quotedText: 'title: "Harbor Jazz Brunch"\nsource: https://pierhall.example/events',
      artifactTitle: 'Harbor Jazz Brunch',
    });

    const sent = sentUserMessage();

    expect(sent).toContain('1. categories\n   before: "Live Music, Jazz Brunch"\n   after: "Live Music, Food & Drink"');
    expect(sent).toContain('Reviewer\'s note: """Pier Hall brunches are food events."""');
    expect(sent).toContain('Rule already proposed from the note: """File brunch events at Pier Hall under Food & Drink."""');
    expect(sent).toContain('source: https://pierhall.example/events');
  });

  it('shows the model the sentence a reviewer fixed late in a long description', async () => {
    modelReplies({ learnings: [] });

    await proposeEditLearnings({ edits: [{ field: 'description', before: LONG_BEFORE, after: LONG_AFTER }] });

    const sent = sentUserMessage();

    expect(sent).toContain('before: "...');
    expect(sent).toContain('Tickets are $15 at the door."');
    expect(sent).toContain('Tickets are free with a brunch order."');
  });

  it('says there was no note when the reviewer typed nothing', async () => {
    modelReplies({ learnings: [] });

    await proposeEditLearnings({ edits: [CATEGORY_EDIT] });

    expect(sentUserMessage()).toContain('Reviewer\'s note: none');
  });

  it('keeps one learning per corrected field and drops any for a field nobody corrected', async () => {
    modelReplies({
      learnings: [
        { field: 'categories', rule_text: 'File brunch listings under Food & Drink.', memory_type: 'knowledge' },
        { field: 'categories', rule_text: 'A second take on the same correction.' },
        { field: 'venue', rule_text: 'A field the reviewer never touched.' },
        { field: 'price', rule_text: '   ' },
      ],
    });

    const learnings = await proposeEditLearnings({
      edits: [CATEGORY_EDIT, { field: 'price', before: '$10', after: 'Free' }],
    });

    expect(learnings).toEqual([
      { field: 'categories', ruleText: 'File brunch listings under Food & Drink.', memoryType: 'knowledge' },
    ]);
  });

  it('proposes at most five learnings from one decision, so a rewrite cannot hold the queue', async () => {
    const edits = Array.from({ length: 8 }, (_, index) => ({ field: `f${index}`, before: 'a', after: 'b' }));
    modelReplies({ learnings: edits.map(edit => ({ field: edit.field, rule_text: `Rule for ${edit.field}.` })) });

    expect((await proposeEditLearnings({ edits })).map(learning => learning.field)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
  });

  it('keeps a learning whose memory type the model made up, without the type', async () => {
    modelReplies({ learnings: [{ field: 'categories', rule_text: 'File brunch listings under Food & Drink.', memory_type: 'hunch' }] });

    expect(await proposeEditLearnings({ edits: [CATEGORY_EDIT] })).toEqual([
      { field: 'categories', ruleText: 'File brunch listings under Food & Drink.' },
    ]);
  });

  it('reads a fenced reply', async () => {
    modelReplies('```json\n{"learnings": [{"field": "categories", "rule_text": "File brunch listings under Food & Drink."}]}\n```');

    expect(await proposeEditLearnings({ edits: [CATEGORY_EDIT] })).toHaveLength(1);
  });

  it('proposes nothing from a reply that is not the promised JSON, and logs that it read nothing', async () => {
    modelReplies('Sure! The category change looks like a one-off.');

    expect(await proposeEditLearnings({ edits: [CATEGORY_EDIT], orgId: 'org_edits' })).toEqual([]);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('not JSON'), { orgId: 'org_edits', fields: 1 });
  });

  it('lets a failed model call throw, so the job that asked fails visibly', async () => {
    invokeMock.mockRejectedValue(new Error('model unavailable'));

    await expect(proposeEditLearnings({ edits: [CATEGORY_EDIT] })).rejects.toThrow('model unavailable');
  });
});
