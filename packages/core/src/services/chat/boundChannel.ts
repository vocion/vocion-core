import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { slackToken } from '@/libs/notifications/slack';
import { chatChannelBindingSchema } from '@/models/Schema';

/**
 * WHERE A WORKSPACE'S POSTS GO.
 *
 * The deployment holds one Slack app (`SLACK_BOT_TOKEN`); a workspace binds
 * channels to agents (`chat_channel_binding`). Anything core posts on a
 * workspace's behalf — a release announcement, a notification, a message an
 * agent proposed — goes to a channel the workspace bound, and nowhere else:
 * the binding is the authorisation, and a channel id an agent typed is not.
 *
 * Two readers share this one lookup so they cannot disagree about the target:
 * `release.announce` (`services/factory/releaseAnnounce.ts`) and
 * `chat.post_message` (`libs/actions/slack-post-message.ts`).
 */

export type BoundSlackChannel = {
  channelId: string;
  teamId: string | null;
  /** The agent the channel answers for; posts wear its persona when the binding has none. */
  agentSlug: string;
};

/**
 * The Slack channel a post for this workspace goes to.
 *
 * With `channelId`: that channel, when THIS workspace bound it; null when it
 * did not — another org's channel, or one nobody bound, is not a target.
 * Without: the workspace's first bound channel, the one notifications and
 * announcements post to. Null when the deployment has no Slack app at all.
 * @param orgId - The workspace.
 * @param channelId - A specific bound channel, when the caller names one.
 */
export async function boundSlackChannel(orgId: string, channelId?: string | null): Promise<BoundSlackChannel | null> {
  if (!slackToken()) {
    return null;
  }
  const scope = and(eq(chatChannelBindingSchema.orgId, orgId), eq(chatChannelBindingSchema.surface, 'slack'));
  const where = channelId
    ? and(scope, eq(chatChannelBindingSchema.channelId, channelId))
    : and(scope, ne(chatChannelBindingSchema.channelId, '*'));
  const [row] = await db
    .select({ channelId: chatChannelBindingSchema.channelId, teamId: chatChannelBindingSchema.teamId, agentSlug: chatChannelBindingSchema.agentSlug })
    .from(chatChannelBindingSchema)
    .where(where)
    .orderBy(asc(chatChannelBindingSchema.id))
    .limit(1);
  return row ? { channelId: row.channelId, teamId: row.teamId ?? null, agentSlug: row.agentSlug } : null;
}
