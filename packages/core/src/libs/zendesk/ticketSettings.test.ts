/**
 * The `tickets` block of a zendesk source: the topic the agent picks becomes
 * only a tag the settings name, the fixed tags and prefix come from the
 * settings, and a bad block is refused by the source's config schema, which is
 * what the workspace apply runs.
 */
import { describe, expect, it } from 'vitest';
import { zendeskConfigSchema } from '@/libs/sources/zendesk';
import { ticketSubjectFor, ticketTagsFor, topicTagFor, zendeskTicketSettingsSchema } from './ticketSettings';

const settings = zendeskTicketSettingsSchema.parse({
  topicTags: { 'Billing': 'billing_queue', 'Lost card': 'cards_queue' },
  fallbackTopicTag: 'else',
  tags: ['vocion-dev', 'else'],
  subjectPrefix: '[TEST]',
});

describe('topicTagFor', () => {
  it('maps a named topic to its tag, ignoring case and surrounding spaces', () => {
    expect(topicTagFor(settings, '  lost CARD ')).toBe('cards_queue');
  });

  it('gives the fallback tag for a topic the settings do not name, never the topic text', () => {
    expect(topicTagFor(settings, 'refund_queue')).toBe('else');
  });
});

describe('ticketTagsFor', () => {
  it('puts the topic tag first, then the fixed tags, each once', () => {
    expect(ticketTagsFor(settings, 'something new')).toEqual(['else', 'vocion-dev']);
    expect(ticketTagsFor(settings, 'billing')).toEqual(['billing_queue', 'vocion-dev', 'else']);
  });
});

describe('ticketSubjectFor', () => {
  it('puts the prefix in front of the subject', () => {
    expect(ticketSubjectFor(settings, ' Card not charging ')).toBe('[TEST] Card not charging');
  });

  it('leaves the subject alone without a prefix', () => {
    const plain = zendeskTicketSettingsSchema.parse({ fallbackTopicTag: 'else' });

    expect(ticketSubjectFor(plain, 'Card not charging')).toBe('Card not charging');
  });
});

describe('zendeskConfigSchema tickets block', () => {
  it('accepts a source without a tickets block', () => {
    expect(zendeskConfigSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['a tag with a space', { fallbackTopicTag: 'else', tags: ['vocion dev'] }],
    ['a missing fallback tag', { topicTags: { billing: 'billing_queue' } }],
    ['a tag with a comma', { fallbackTopicTag: 'else,other' }],
    ['an unknown key', { fallbackTopicTag: 'else', requester: 'someone@example.com' }],
  ])('refuses %s, so the workspace apply fails instead of an end user\'s tap', (_label, tickets) => {
    expect(zendeskConfigSchema.safeParse({ tickets }).success).toBe(false);
  });
});
