import { describe, expect, it } from 'vitest';
import { classifyFeedback, feedbackNote } from './feedbackSignal';

/**
 * The three sentences are the CEO's, said in a Slack thread on 2026-09-15
 * after an agent fumbled a reply. They are the bar: if the classifier misses
 * any of them, feedback that produced this whole change would not have been
 * filed by it.
 */
const CEO = [
  'you should have had context of the channel, thread, posters and your posted from workspace here.',
  'you should be able to find existing or create screenshots to answer this question. And have that behavior and capability in the original post.',
  'I should have been able to give you these instructions from that slack thread that let you plan and kickoff development work. With the 0 person agent team in that workspace. To close this functional gap. That aligns with the use and feedback makes Vocion better. EVERY FEEDBACK. When appropriate. In our manifesto.',
];

describe('classifyFeedback', () => {
  it.each(CEO)('reads a "you should have…" as feedback: %s', (sentence) => {
    const signal = classifyFeedback(sentence);

    expect(signal.verdict).toBe('feedback');
    expect(signal.signals.length).toBeGreaterThan(0);
  });

  it('does not file gratitude or a logistics question', () => {
    expect(classifyFeedback('thanks!').verdict).toBe('not_feedback');
    expect(classifyFeedback('Thank you').verdict).toBe('not_feedback');
    expect(classifyFeedback('👍').verdict).toBe('not_feedback');
    expect(classifyFeedback('what time is the standup?').verdict).toBe('not_feedback');
    expect(classifyFeedback('how many deals closed last week?').verdict).toBe('not_feedback');
    expect(classifyFeedback('').verdict).toBe('not_feedback');
  });

  it('reads a complaint and a "why doesn\'t it" as feedback', () => {
    expect(classifyFeedback('the reply in that thread is broken').verdict).toBe('feedback');
    expect(classifyFeedback('why doesn\'t it attach the screenshot?').verdict).toBe('feedback');
    expect(classifyFeedback('that is not what I asked for').verdict).toBe('feedback');
  });

  it('leaves a single weak request to the model rather than guessing', () => {
    // One request pattern and nothing else: a human might mean either, so the
    // heuristic declines to decide instead of filing noise.
    expect(classifyFeedback('can you pull the numbers for Q3?').verdict).toBe('unsure');
    // Two of them together is a request about the product, not about data.
    expect(classifyFeedback('can you please add a screenshot to these posts').verdict).toBe('feedback');
  });

  it('names the tool in the note, and says nothing at all when there is nothing to file', () => {
    expect(feedbackNote(classifyFeedback('thanks!'))).toBe('');
    expect(feedbackNote(classifyFeedback(CEO[0]!))).toContain('file_feedback');
    // The rule that keeps decision 025 intact: nothing runs from the chat surface.
    expect(feedbackNote(classifyFeedback(CEO[0]!))).toContain('Do not start the work from here');
  });
});
