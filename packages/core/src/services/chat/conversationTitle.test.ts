/**
 * A thread's name after its first reply (`conversationTitle.ts`): when it is
 * written, when it is not, and that the first-message cut survives every
 * failure. The model is a seam here — no test calls out to a vendor.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema } = await import('@/models/Schema');
const svc = await import('@/services/ConversationService');
const { cleanTitle, scheduleConversationTitle, titleAfterFirstReply } = await import('./conversationTitle');

const ORG = 'org_title_test';
const OTHER = 'org_title_other';

beforeEach(async () => {
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

/**
 * A model that always answers `text`, and records how often it was asked.
 * @param text
 */
function modelSaying(text: string) {
  return vi.fn(async () => ({ text }));
}

async function thread(turns: Array<['user' | 'assistant', string]>, orgId = ORG) {
  const conv = await svc.createConversation({ orgId, agentSlug: 'revenue-lead' });
  for (const [role, content] of turns) {
    await svc.appendMessage({ orgId, conversationId: conv.id, role, content });
  }
  return conv.id;
}

async function row(id: number) {
  const [r] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, id));
  return r!;
}

describe('cleanTitle', () => {
  it('keeps at most six words, drops quotes, labels and the trailing period, and capitalises the first letter', () => {
    expect(cleanTitle('"northwind renewal risk and next steps for the quarter."')).toBe('Northwind renewal risk and next steps');
    expect(cleanTitle('Title: Kestrel Capital pipeline review.')).toBe('Kestrel Capital pipeline review');
    expect(cleanTitle('**Contoso supply forecast**\nsecond line ignored')).toBe('Contoso supply forecast');
  });

  it('returns null for a reply with nothing in it', () => {
    expect(cleanTitle('')).toBeNull();
    expect(cleanTitle('""')).toBeNull();
    expect(cleanTitle('...')).toBeNull();
  });
});

describe('titleAfterFirstReply', () => {
  it('names the thread after the first reply and marks it generated', async () => {
    const id = await thread([['user', 'hey can you look at the northwind renewal and tell me where it stands'], ['assistant', 'Northwind renews on 1 March; the champion left in June.']]);

    expect((await row(id)).title).toBe('hey can you look at the northwind renewal and tell me where…');

    const model = modelSaying('Northwind renewal status');
    const outcome = await titleAfterFirstReply({ orgId: ORG, conversationId: id, model });

    expect(outcome).toEqual({ titled: true, title: 'Northwind renewal status' });
    expect(model).toHaveBeenCalledTimes(1);

    // The model reads the question and the answer, never more.
    const [, user] = model.mock.calls[0] as unknown as [string, string];

    expect(user).toContain('northwind renewal');
    expect(user).toContain('champion left');

    const after = await row(id);

    expect(after.title).toBe('Northwind renewal status');
    expect(after.titleSource).toBe('generated');
  });

  it('does not run before the first reply, or after the second', async () => {
    const onlyAsked = await thread([['user', 'what changed on the Kestrel deal?']]);
    const model = modelSaying('Kestrel deal changes');

    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: onlyAsked, model })).toEqual({ titled: false, reason: 'not-first-reply' });

    const twoReplies = await thread([['user', 'first'], ['assistant', 'one'], ['user', 'second'], ['assistant', 'two']]);

    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: twoReplies, model })).toEqual({ titled: false, reason: 'not-first-reply' });
    expect(model).not.toHaveBeenCalled();
  });

  it('never replaces a title a person gave, not even one given while the model was thinking', async () => {
    const renamed = await thread([['user', 'pipeline?'], ['assistant', 'Six open deals.']]);
    await svc.renameConversation({ orgId: ORG, id: renamed, title: 'My pipeline notes' });
    const model = modelSaying('Open pipeline overview');

    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: renamed, model })).toEqual({ titled: false, reason: 'not-auto' });
    expect(model).not.toHaveBeenCalled();

    // The race: the rename lands between the read and the write.
    const racing = await thread([['user', 'pipeline?'], ['assistant', 'Six open deals.']]);
    const slow = vi.fn(async () => {
      await svc.renameConversation({ orgId: ORG, id: racing, title: 'Named mid-flight' });
      return { text: 'Open pipeline overview' };
    });

    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: racing, model: slow })).toEqual({ titled: false, reason: 'changed' });
    expect((await row(racing)).title).toBe('Named mid-flight');
    expect((await row(racing)).titleSource).toBe('person');
  });

  it('keeps the first-message title when the model fails or answers nothing usable', async () => {
    const id = await thread([['user', 'summarise the Bellwater Hall booking'], ['assistant', 'Booked for 12 May.']]);
    const failing = vi.fn(async () => {
      throw new Error('no key');
    });

    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: id, model: failing })).toEqual({ titled: false, reason: 'no-title' });
    expect(await titleAfterFirstReply({ orgId: ORG, conversationId: id, model: modelSaying('  ""  ') })).toEqual({ titled: false, reason: 'no-title' });

    const after = await row(id);

    expect(after.title).toBe('summarise the Bellwater Hall booking');
    expect(after.titleSource).toBe('auto');
  });

  it('is org scoped: another workspace cannot title this thread', async () => {
    const id = await thread([['user', 'q'], ['assistant', 'a']]);
    const model = modelSaying('Something');

    expect(await titleAfterFirstReply({ orgId: OTHER, conversationId: id, model })).toEqual({ titled: false, reason: 'not-found' });
    expect(model).not.toHaveBeenCalled();
  });
});

describe('scheduleConversationTitle', () => {
  it('returns at once and writes the title in the background', async () => {
    const id = await thread([['user', 'how is Acme trending'], ['assistant', 'Up 12% on last quarter.']]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = vi.fn(async () => {
      await gate;
      return { text: 'Acme quarterly trend' };
    });

    expect(scheduleConversationTitle({ orgId: ORG, conversationId: id, model })).toBeUndefined();
    // Not awaited: nothing is written until the model answers.
    expect((await row(id)).titleSource).toBe('auto');

    release();
    await vi.waitFor(async () => {
      expect((await row(id)).title).toBe('Acme quarterly trend');
    });
  });
});

describe('renameConversation', () => {
  it('marks the title person, collapses whitespace, and is org scoped', async () => {
    const id = await thread([['user', 'q'], ['assistant', 'a']]);

    expect(await svc.renameConversation({ orgId: OTHER, id, title: 'Hijack' })).toBeNull();
    expect((await row(id)).title).toBe('q');

    const renamed = await svc.renameConversation({ orgId: ORG, id, title: '  Contoso   supply plan ' });

    expect(renamed?.title).toBe('Contoso supply plan');
    expect(renamed?.titleSource).toBe('person');
  });

  it('keeps a person-chosen initial title through the first message', async () => {
    const conv = await svc.createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: 'Board prep', titleSource: 'person' });
    await svc.appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'start' });

    expect((await row(conv.id)).title).toBe('Board prep');
  });
});
