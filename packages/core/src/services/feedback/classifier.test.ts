/**
 * What the comment classifier is shown.
 *
 * Structured feedback puts the person's own words last, after a line per
 * corrected field. A cut sized for a one-line comment (1,000 characters) sliced
 * those words off whenever a few fields had changed, and they are the part
 * that becomes a rule. These pin the cut to where it no longer does that,
 * while still bounding a runaway paste.
 */
import { HumanMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

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

const { classifyComment } = await import('@/services/feedback/classifier');

/** The user message the classifier sent to the model on its last call. */
function sentUserMessage(): string {
  const messages = invokeMock.mock.calls.at(-1)?.[0] as unknown[];
  const human = messages.find(message => message instanceof HumanMessage) as HumanMessage;
  return String(human.content);
}

/**
 * A correction line clipped the way a caller clips one: 200 characters a side.
 * @param field - The corrected field's name.
 */
function correctionLine(field: string): string {
  return `${field}: "${'a'.repeat(200)}" became "${'b'.repeat(200)}"`;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ content: '{"bucket": "rule", "rule_text": "Brunch events are Food & Drink."}' });
});

describe('classifyComment input', () => {
  it('keeps the person\'s note when every field of a record was corrected first', async () => {
    const fields = ['title', 'description', 'start', 'end', 'seriesMatch', 'seriesKey', 'categories'];
    const note = 'Moderator\'s note: Bellwater Hall lists brunch under Food & Drink, never Live Music.';
    const text = [
      'A moderator approved the agent-proposed event candidate "Jazz Night".',
      `Fields corrected before publishing: ${fields.map(correctionLine).join('; ')}.`,
      note,
    ].join(' ');

    expect(text.length).toBeGreaterThan(3_000);

    await classifyComment({ text, artifactTitle: 'Jazz Night' });

    expect(sentUserMessage()).toContain(note);
  });

  it('still bounds a runaway comment', async () => {
    await classifyComment({ text: 'x'.repeat(50_000) });

    const sent = sentUserMessage();

    expect(sent).toContain('x'.repeat(10_000));
    expect(sent).not.toContain('x'.repeat(10_001));
  });

  it('reads up to 1,500 characters of the quoted target', async () => {
    const quotedText = `${'q'.repeat(1_400)} source: https://bellwater.example/events`;

    await classifyComment({ text: 'Wrong category.', quotedText });

    expect(sentUserMessage()).toContain('source: https://bellwater.example/events');
  });
});
