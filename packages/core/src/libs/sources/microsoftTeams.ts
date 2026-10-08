/**
 * Microsoft Teams connector — ingest channel conversations as retrievable
 * documents, the Microsoft 365 counterpart of the Slack connector.
 *
 * Auth: the workspace's Microsoft login, delegated, so it reads the teams and
 * channels the person who logged in belongs to (`Team.ReadBasic.All`,
 * `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, which needs an admin's
 * consent for the organization). One document per thread: the root message
 * and its replies, so a search hit carries the whole conversation.
 *
 * Scope: `teamId` and `channelId` narrow it to one team or one channel; with
 * neither it sweeps every channel of every team the person is in, as Slack
 * sweeps every channel its bot was invited to. Chats (one-to-one and group)
 * are personal and are never synced; `msteams_read_chat` reads one live.
 *
 * Graph's channel-message delta takes a `lastModifiedDateTime` filter, so a
 * run reads only roots changed inside its window: since `ctx.since` on an
 * incremental run, the last `pastDays` on a full one, which is also the
 * reconcile pass that lets a deleted thread leave the index. Each root's
 * replies are read with it. A reply to a thread whose root has not changed in
 * the window waits for the root to change; `msteams_read_channel` reads any
 * thread live.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { GRAPH_BASE, GraphError, graphPages, htmlToText, persistTo, resolveGraphToken } from '@/libs/microsoft/graph';
import { inspectMicrosoft } from '@/libs/microsoft/inspect';

export const TEAMS_SLUG = 'microsoft-teams';

const teamsConfigSchema = z.object({
  /** One team's id. Blank: every team the person who logged in belongs to. */
  teamId: z.string().min(1).optional(),
  /** One channel's id inside `teamId`. Blank: every channel of the team(s). */
  channelId: z.string().min(1).optional(),
  /** Full-sync window: how far back to index threads. */
  pastDays: z.number().int().positive().default(30),
  baseUrl: z.string().url().default(GRAPH_BASE),
});

export type TeamsTeam = { id: string; displayName?: string; description?: string | null };
export type TeamsChannel = { id: string; displayName?: string; description?: string | null; membershipType?: string; webUrl?: string };
export type TeamsMessage = {
  id: string;
  replyToId?: string | null;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  lastEditedDateTime?: string | null;
  deletedDateTime?: string | null;
  subject?: string | null;
  body?: { contentType?: string; content?: string };
  from?: { user?: { displayName?: string; id?: string } | null; application?: { displayName?: string } | null } | null;
  webUrl?: string;
};

/**
 * Who wrote a message, as a person reads it.
 * @param msg - The message.
 */
export function authorOf(msg: TeamsMessage): string {
  return msg.from?.user?.displayName ?? msg.from?.application?.displayName ?? 'someone';
}

/**
 * A message's text: HTML bodies (the Teams default) with their tags dropped.
 * @param msg - The message.
 */
export function teamsMessageText(msg: TeamsMessage): string {
  const content = msg.body?.content ?? '';
  return msg.body?.contentType?.toLowerCase() === 'html' ? htmlToText(content) : content.trim();
}

/**
 * Whether a message is something a person wrote, not a system event (member
 * added, channel renamed) or a deleted message's tombstone.
 * @param msg - The message.
 */
export function isPersonMessage(msg: TeamsMessage): boolean {
  return (msg.messageType ?? 'message') === 'message' && !msg.deletedDateTime;
}

/**
 * The latest change on a thread: its root's or any reply's.
 * @param root - The root message.
 * @param replies - Its replies.
 */
function latestChange(root: TeamsMessage, replies: TeamsMessage[]): number {
  return [root, ...replies].reduce((max, m) => Math.max(max, Date.parse(m.lastModifiedDateTime ?? m.createdDateTime ?? '') || 0), 0);
}

/**
 * One thread as text a search can match and a model can quote.
 * @param team - The team the channel is in.
 * @param channel - Where it was posted.
 * @param root - The root message.
 * @param replies - Its replies, oldest first.
 */
export function renderThread(team: TeamsTeam, channel: TeamsChannel, root: TeamsMessage, replies: TeamsMessage[]): string {
  const line = (m: TeamsMessage) => `[${m.createdDateTime ?? ''}] ${authorOf(m)}: ${teamsMessageText(m)}`;
  return [
    `Team: ${team.displayName ?? team.id} · Channel: ${channel.displayName ?? channel.id}`,
    root.subject ? `Subject: ${root.subject}` : '',
    '',
    line(root),
    ...replies.filter(isPersonMessage).map(line),
  ].filter((l, i) => l !== '' || i === 2).join('\n');
}

/**
 * The teams to read: the one named, or every team the person belongs to.
 * @param token - The access token.
 * @param cfg - The source's settings.
 * @param cfg.teamId - One team, when named.
 * @param baseUrl - The Graph base.
 */
async function teamsInScope(token: string, cfg: { teamId?: string }, baseUrl: string): Promise<TeamsTeam[]> {
  if (cfg.teamId) {
    return [{ id: cfg.teamId }];
  }
  const teams: TeamsTeam[] = [];
  for await (const team of graphPages<TeamsTeam>(token, { path: '/me/joinedTeams?$select=id,displayName', what: 'the teams this login belongs to', baseUrl })) {
    teams.push(team);
  }
  return teams;
}

/**
 * The channels to read in one team: the one named, or all of them.
 * @param token - The access token.
 * @param team - The team.
 * @param channelId - One channel, when named.
 * @param baseUrl - The Graph base.
 */
async function channelsInScope(token: string, team: TeamsTeam, channelId: string | undefined, baseUrl: string): Promise<TeamsChannel[]> {
  const channels: TeamsChannel[] = [];
  for await (const channel of graphPages<TeamsChannel>(token, { path: `/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,membershipType,webUrl`, what: `the channels of ${team.displayName ?? 'a team'}`, baseUrl })) {
    if (!channelId || channel.id === channelId) {
      channels.push(channel);
    }
  }
  if (channelId && channels.length === 0) {
    // Named but not listed (a private channel the listing hides): read it anyway.
    channels.push({ id: channelId });
  }
  return channels;
}

/**
 * Every reply to a thread, oldest first.
 * @param token - The access token.
 * @param teamId - The team.
 * @param channelId - The channel.
 * @param messageId - The root message.
 * @param baseUrl - The Graph base.
 */
export async function threadReplies(token: string, teamId: string, channelId: string, messageId: string, baseUrl: string = GRAPH_BASE): Promise<TeamsMessage[]> {
  const replies: TeamsMessage[] = [];
  const path = `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/replies?$top=50`;
  for await (const reply of graphPages<TeamsMessage>(token, { path, what: 'replies in a Teams thread', baseUrl })) {
    replies.push(reply);
  }
  return replies.sort((a, b) => Date.parse(a.createdDateTime ?? '') - Date.parse(b.createdDateTime ?? ''));
}

/**
 * A channel's root messages changed after an instant (Graph's delta, which is
 * the one channel listing that filters by time).
 * @param teamId - The team.
 * @param channelId - The channel.
 * @param changedAfter - ISO instant.
 */
export function channelDeltaPath(teamId: string, channelId: string, changedAfter: string): string {
  const params = new URLSearchParams({ $filter: `lastModifiedDateTime gt ${changedAfter}`, $top: '50' });
  return `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/delta?${params.toString()}`;
}

export const teamsConnector: SourceConnector<typeof teamsConfigSchema> = {
  slug: TEAMS_SLUG,
  name: 'Microsoft Teams',
  description: 'Conversations from Microsoft Teams channels. Each thread with its replies, synced incrementally by last change.',
  icon: 'MessageSquare',
  authKind: 'oauth',
  brand: 'microsoftteams',
  configSchema: teamsConfigSchema,
  defaultReconcileCron: '25 4 * * *',
  requiredScopes: ['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All'],
  inspectNote: 'Reads who the Microsoft login is and lists the teams it belongs to. Nothing is saved, except an expired login it renews for a connected source.',
  inspect: input => inspectMicrosoft(TEAMS_SLUG, {
    label: 'List the teams',
    run: async (token, _config, baseUrl) => {
      const names: string[] = [];
      for await (const team of graphPages<TeamsTeam>(token, { path: '/me/joinedTeams?$select=id,displayName', what: 'the teams this login belongs to', baseUrl }, 5)) {
        names.push(team.displayName ?? team.id);
      }
      return names.length === 0 ? 'This login belongs to no team.' : `${names.length} team${names.length === 1 ? '' : 's'}: ${names.slice(0, 8).join(', ')}`;
    },
  }, input),
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = teamsConfigSchema.parse(ctx.config);
    const token = await resolveGraphToken(ctx.credentials, persistTo(ctx.orgId, ctx.sourceId, message => ctx.onProgress?.({ kind: 'error', message })), TEAMS_SLUG);
    const windowStart = Date.now() - cfg.pastDays * 86_400_000;
    const since = ctx.since?.getTime() ?? null;
    const changedAfter = new Date(since ?? windowStart).toISOString();
    for (const team of await teamsInScope(token, cfg, cfg.baseUrl)) {
      for (const channel of await channelsInScope(token, team, cfg.channelId, cfg.baseUrl)) {
        try {
          for await (const root of graphPages<TeamsMessage>(token, { path: channelDeltaPath(team.id, channel.id, changedAfter), what: `messages in ${channel.displayName ?? 'a Teams channel'}`, baseUrl: cfg.baseUrl })) {
            if (!isPersonMessage(root)) {
              ctx.onProgress?.({ kind: 'skipped', uri: root.id });
              continue;
            }
            const replies = await threadReplies(token, team.id, channel.id, root.id, cfg.baseUrl);
            const changed = latestChange(root, replies);
            if (changed < windowStart) {
              ctx.onProgress?.({ kind: 'skipped', uri: root.id });
              continue;
            }
            if (since !== null && changed < since) {
              ctx.onProgress?.({ kind: 'skipped', uri: root.id });
              continue;
            }
            ctx.onProgress?.({ kind: 'fetched', uri: root.id });
            const text = teamsMessageText(root);
            yield {
              externalId: `msteams:${team.id}:${channel.id}:${root.id}`,
              title: root.subject || `${channel.displayName ?? 'Teams'}: ${text.slice(0, 80) || '(no text)'}`,
              content: renderThread(team, channel, root, replies),
              lastModifiedAt: changed > 0 ? new Date(changed) : null,
              metadata: {
                kind: 'msteams-thread',
                teamId: team.id,
                teamName: team.displayName ?? null,
                channelId: channel.id,
                channelName: channel.displayName ?? null,
                messageId: root.id,
                author: authorOf(root),
                replyCount: replies.filter(isPersonMessage).length,
                webUrl: root.webUrl ?? null,
              },
            };
          }
        } catch (error) {
          // One channel this login cannot read (a private channel it left)
          // must not cost the others; the run counts it and skips tombstoning.
          if (error instanceof GraphError && (error.status === 403 || error.status === 404)) {
            ctx.onProgress?.({ kind: 'error', uri: channel.id, message: error.message });
            continue;
          }
          throw error;
        }
      }
    }
  },
};
