/**
 * The `tickets` block of a zendesk source: how a hand-off ticket is tagged and
 * titled in this workspace's Zendesk.
 *
 * Nothing here comes from the model. The agent picks a topic name for the
 * ticket; this block turns that name into the tag the account's own triggers
 * route on, and adds the account's fixed tags (an environment tag, say) and an
 * optional subject prefix (`[TEST]` on a test workspace). The requester never
 * comes from here either: it is the end user who tapped the card.
 *
 * The block is checked when the workspace applies, because it is part of the
 * source's `configSchema` (`libs/sources/zendesk.ts`, run by
 * `validateSourceSpec` in `libs/sources/upsert.ts`). A bad block fails there,
 * in front of the person editing the workspace, and never on an end user's tap.
 */
import { z } from 'zod';

/** One tag. A tag here has no spaces or commas, so it reaches Zendesk as exactly one tag. */
const zendeskTagSchema = z.string().trim().min(1).max(80).regex(/^[^\s,]+$/, 'A Zendesk tag here has no spaces or commas.');

export const zendeskTicketSettingsSchema = z.object({
  /** Topic name, as the agent picks it, to the tag the account routes that topic on. */
  topicTags: z.record(z.string().trim().min(1).max(60), zendeskTagSchema).default({}),
  /** The tag for a topic the agent named that is not in `topicTags`. */
  fallbackTopicTag: zendeskTagSchema,
  /** Tags every hand-off ticket carries, like an environment tag. */
  tags: z.array(zendeskTagSchema).max(20).default([]),
  /** Put in front of every subject, like `[TEST]` on a test workspace. Empty for none. */
  subjectPrefix: z.string().max(40).default(''),
}).strict();

export type ZendeskTicketSettings = z.infer<typeof zendeskTicketSettingsSchema>;

/**
 * The tag for the topic the agent picked: its own tag when the settings name
 * it (matched without regard to case or surrounding spaces), the fallback tag
 * otherwise. Never the topic text itself, so the model can't invent a tag the
 * account's triggers don't know.
 * @param settings - The validated `tickets` block.
 * @param topic - The topic the agent picked.
 */
export function topicTagFor(settings: ZendeskTicketSettings, topic: string): string {
  const wanted = topic.trim().toLowerCase();
  for (const [name, tag] of Object.entries(settings.topicTags)) {
    if (name.trim().toLowerCase() === wanted) {
      return tag;
    }
  }
  return settings.fallbackTopicTag;
}

/**
 * The tags one hand-off ticket carries: its topic tag, then the fixed tags,
 * each once, in that order.
 * @param settings - The validated `tickets` block.
 * @param topic - The topic the agent picked.
 */
export function ticketTagsFor(settings: ZendeskTicketSettings, topic: string): string[] {
  return [...new Set([topicTagFor(settings, topic), ...settings.tags])];
}

/**
 * The subject Zendesk gets: the prefix, a space, then the agent's subject.
 * @param settings - The validated `tickets` block.
 * @param subject - The agent's subject.
 */
export function ticketSubjectFor(settings: ZendeskTicketSettings, subject: string): string {
  const prefix = settings.subjectPrefix.trim();
  return prefix ? `${prefix} ${subject.trim()}` : subject.trim();
}
