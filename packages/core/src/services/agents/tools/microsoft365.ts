/**
 * The Microsoft 365 read tools — live reads through Microsoft Graph with the
 * workspace's own Microsoft login, for an agent whose sources include the
 * matching connector. The synced index answers "what do we know about X";
 * these answer "what does it say right now", in full:
 *
 * - `outlook_search_mail`, `get_outlook_thread` — with an Outlook mail source.
 * - `msteams_list_channels`, `msteams_read_channel`, `msteams_read_chat` — with a Teams source.
 * - `microsoft_files_search`, `microsoft_file_read` — with a OneDrive or SharePoint source.
 *
 * Outlook Calendar is read through `calendar_events`, the one calendar tool,
 * which reads whichever calendars the agent holds (`calendarEvents.ts`).
 * The writes are actions (`msteams.post_message`, `outlook.create_event`)
 * through `propose_action`, so the trust ladder and the ledger apply.
 *
 * Every tool returns JSON with `ok`; a failure carries the sentence that says
 * what to fix, never a vendor's free text.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { TeamsChannel, TeamsMessage, TeamsTeam } from '@/libs/sources/microsoftTeams';
import type { OutlookMessage } from '@/libs/sources/outlookMail';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { kindOfSource } from '@/libs/connectors/families';
import { graphJson, graphPages, persistTo, resolveGraphToken } from '@/libs/microsoft/graph';
import { readDriveItemText } from '@/libs/sources/microsoftFiles';
import { authorOf, isPersonMessage, TEAMS_SLUG, teamsMessageText, threadReplies } from '@/libs/sources/microsoftTeams';
import { fetchOutlookThreadDoc, OUTLOOK_MAIL_SLUG, recipientText } from '@/libs/sources/outlookMail';
import { firstCredentialed, sourcesForConnector } from './zoomTranscript';

/** Text the model reads whole; past this a file is cut once and says so. */
const FILE_TEXT_MAX = 60_000;

/**
 * Whether the agent holds a source of this connector, narrowed by the
 * person's source ACL when one is set.
 * @param ctx - The turn.
 * @param connectorSlug - The connector, e.g. `teams`.
 */
export function microsoftInScope(ctx: Pick<RuntimeContext, 'connectorSources' | 'sourceKinds' | 'allowedSourceSlugs'>, connectorSlug: string): boolean {
  const allowed = ctx.allowedSourceSlugs ? new Set(ctx.allowedSourceSlugs) : null;
  return ctx.connectorSources.some((slug) => {
    const ofConnector = kindOfSource(ctx, slug) === connectorSlug || slug === connectorSlug || slug.startsWith(`${connectorSlug}-`);
    return ofConnector && (!allowed || allowed.has(slug));
  });
}

/**
 * The Graph token for one of the agent's connectors: the first of its sources
 * with a stored credential, refreshed and saved to that source when expiring.
 * @param orgId - The workspace.
 * @param connectorSlugs - The connectors to look in, first match wins.
 */
export async function graphTokenForConnector(orgId: string, connectorSlugs: readonly string[]): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  for (const connectorSlug of connectorSlugs) {
    const sources = await sourcesForConnector(orgId, connectorSlug);
    const credentialed = await firstCredentialed(orgId, sources);
    if (credentialed) {
      const token = await resolveGraphToken(credentialed.credentials, persistTo(orgId, credentialed.source.id), connectorSlug);
      return { ok: true, token };
    }
  }
  return { ok: false, error: 'No Microsoft 365 login is stored for this workspace. An admin needs to log in with Microsoft on the Connectors page.' };
}

/**
 * Run a read and wrap it as the JSON every tool here returns.
 * @param read - The read.
 */
async function answer(read: () => Promise<Record<string, unknown>>): Promise<string> {
  try {
    return JSON.stringify({ ok: true, ...(await read()) });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Microsoft 365 could not be read.' });
  }
}

/**
 * A token or a thrown sentence, for use inside `answer`.
 * @param orgId - The workspace.
 * @param connectorSlugs - The connectors to look in.
 */
async function tokenOrThrow(orgId: string, connectorSlugs: readonly string[]): Promise<string> {
  const got = await graphTokenForConnector(orgId, connectorSlugs);
  if (!got.ok) {
    throw new Error(got.error);
  }
  return got.token;
}

function outlookTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const search = tool(
    async args => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, [OUTLOOK_MAIL_SLUG]);
      const params = new URLSearchParams({
        $search: `"${args.query.replace(/"/g, '')}"`,
        $top: String(Math.min(Math.max(args.limit ?? 15, 1), 50)),
        $select: 'id,conversationId,subject,bodyPreview,from,receivedDateTime,webLink',
      });
      const body = await graphJson<{ value?: OutlookMessage[] }>(token, { path: `/me/messages?${params.toString()}`, what: 'Outlook mail search' });
      return {
        messages: (body.value ?? []).map(m => ({
          id: m.id,
          conversationId: m.conversationId ?? null,
          subject: m.subject ?? '',
          from: recipientText(m.from),
          receivedAt: m.receivedDateTime ?? null,
          preview: m.bodyPreview ?? '',
          webLink: m.webLink ?? null,
        })),
        note: 'Read a whole conversation with get_outlook_thread and its conversationId.',
      };
    }),
    {
      name: 'outlook_search_mail',
      description: 'Search the connected Outlook mailbox LIVE (Microsoft 365), the way the Outlook search box does: words, a person, a company, `from:` and `subject:` all work. Returns matching messages newest first with sender, date, preview and the conversation id. Use for mail newer than the last sync or to find a specific thread; then read it whole with get_outlook_thread.',
      schema: z.object({
        query: z.string().min(1).describe('What to search for, as typed into Outlook search.'),
        limit: z.number().int().optional().describe('How many messages, 1-50 (default 15).'),
      }),
    },
  );

  const thread = tool(
    async args => answer(async () => {
      if (!args.conversation_id && !args.message_id) {
        throw new Error('Pass conversation_id or message_id — one of the two is required.');
      }
      const token = await tokenOrThrow(ctx.orgId, [OUTLOOK_MAIL_SLUG]);
      let conversationId = args.conversation_id;
      if (!conversationId && args.message_id) {
        const msg = await graphJson<{ conversationId?: string }>(token, { path: `/me/messages/${encodeURIComponent(args.message_id)}?$select=conversationId`, what: 'an Outlook message' });
        conversationId = msg.conversationId;
      }
      if (!conversationId) {
        throw new Error('Outlook did not say which conversation that message is in.');
      }
      const doc = await fetchOutlookThreadDoc(token, conversationId);
      if (!doc) {
        throw new Error(`Outlook has no messages in conversation "${conversationId}".`);
      }
      const meta = doc.metadata as Record<string, unknown>;
      return { title: doc.title, messageCount: meta.messageCount, webLink: meta.webLink, fetchedAt: meta.fetchedAt, content: doc.content };
    }),
    {
      name: 'get_outlook_thread',
      description: 'Get the FULL text of one Outlook conversation (every message: sender, recipients, date, body), read live from Microsoft 365, by conversation id or any message id in it. Use when you need the verbatim exchange rather than the synced previews.',
      schema: z.object({
        conversation_id: z.string().optional().describe('The Outlook conversationId (preferred).'),
        message_id: z.string().optional().describe('Any Outlook message id in the conversation — resolved to its conversation.'),
      }),
    },
  );
  return [search, thread];
}

function teamsTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const listChannels = tool(
    async () => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, [TEAMS_SLUG]);
      const teams: Array<{ id: string; name: string; channels: Array<{ id: string; name: string; membershipType: string | null }> }> = [];
      for await (const team of graphPages<TeamsTeam>(token, { path: '/me/joinedTeams?$select=id,displayName', what: 'the teams this login belongs to' }, 10)) {
        const channels: Array<{ id: string; name: string; membershipType: string | null }> = [];
        for await (const channel of graphPages<TeamsChannel>(token, { path: `/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,membershipType`, what: `the channels of ${team.displayName ?? 'a team'}` }, 5)) {
          channels.push({ id: channel.id, name: channel.displayName ?? channel.id, membershipType: channel.membershipType ?? null });
        }
        teams.push({ id: team.id, name: team.displayName ?? team.id, channels });
      }
      return { teams, note: 'Read a channel with msteams_read_channel (team_id, channel_id). Post to one with propose_action msteams.post_message.' };
    }),
    {
      name: 'msteams_list_channels',
      description: 'List the Microsoft Teams teams the connected account belongs to, each with its channels and their ids. Call it to find the team_id and channel_id the other Teams tools and msteams.post_message take.',
      schema: z.object({}),
    },
  );

  const readChannel = tool(
    async args => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, [TEAMS_SLUG]);
      const base = `/teams/${encodeURIComponent(args.team_id)}/channels/${encodeURIComponent(args.channel_id)}/messages`;
      const roots: TeamsMessage[] = [];
      if (args.message_id) {
        roots.push(await graphJson<TeamsMessage>(token, { path: `${base}/${encodeURIComponent(args.message_id)}`, what: 'a Teams message' }));
      } else {
        const limit = Math.min(Math.max(args.limit ?? 10, 1), 30);
        const page = await graphJson<{ value?: TeamsMessage[] }>(token, { path: `${base}?$top=${limit}`, what: 'messages in a Teams channel' });
        roots.push(...(page.value ?? []).filter(isPersonMessage).slice(0, limit));
      }
      const threads = [];
      for (const root of roots) {
        const replies = await threadReplies(token, args.team_id, args.channel_id, root.id);
        threads.push({
          messageId: root.id,
          subject: root.subject ?? null,
          author: authorOf(root),
          at: root.createdDateTime ?? null,
          text: teamsMessageText(root),
          webUrl: root.webUrl ?? null,
          replies: replies.filter(isPersonMessage).map(r => ({ author: authorOf(r), at: r.createdDateTime ?? null, text: teamsMessageText(r) })),
        });
      }
      return { threads };
    }),
    {
      name: 'msteams_read_channel',
      description: 'Read a Microsoft Teams channel LIVE: its most recent threads with every reply, or one thread by message_id. Get team_id and channel_id from msteams_list_channels.',
      schema: z.object({
        team_id: z.string().min(1).describe('The team\'s id.'),
        channel_id: z.string().min(1).describe('The channel\'s id (19:…@thread.tacv2).'),
        message_id: z.string().optional().describe('One thread\'s root message id; omit for the latest threads.'),
        limit: z.number().int().optional().describe('How many recent threads, 1-30 (default 10).'),
      }),
    },
  );

  const readChat = tool(
    async args => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, [TEAMS_SLUG]);
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
      if (!args.chat_id) {
        const page = await graphJson<{ value?: Array<{ id: string; topic?: string | null; chatType?: string; lastUpdatedDateTime?: string; members?: Array<{ displayName?: string }> }> }>(token, {
          path: `/me/chats?$top=${limit}&$expand=members`,
          what: 'Teams chats',
        });
        return {
          chats: (page.value ?? []).map(c => ({
            id: c.id,
            topic: c.topic ?? null,
            type: c.chatType ?? null,
            lastUpdated: c.lastUpdatedDateTime ?? null,
            members: (c.members ?? []).map(m => m.displayName).filter(Boolean),
          })),
          note: 'Read one chat with msteams_read_chat and its id.',
        };
      }
      const page = await graphJson<{ value?: TeamsMessage[] }>(token, { path: `/chats/${encodeURIComponent(args.chat_id)}/messages?$top=${limit}`, what: 'a Teams chat' });
      const messages = (page.value ?? []).filter(isPersonMessage).reverse().map(m => ({ author: authorOf(m), at: m.createdDateTime ?? null, text: teamsMessageText(m) }));
      return { chatId: args.chat_id, messages };
    }),
    {
      name: 'msteams_read_chat',
      description: 'Read the connected account\'s Microsoft Teams chats (one-to-one and group) LIVE. Without chat_id it lists recent chats with their members; with chat_id it returns that chat\'s latest messages, oldest first. Chats are never synced into search.',
      schema: z.object({
        chat_id: z.string().optional().describe('A chat\'s id from the list; omit to list chats.'),
        limit: z.number().int().optional().describe('How many chats or messages, 1-50 (default 20).'),
      }),
    },
  );
  return [listChannels, readChannel, readChat];
}

type SearchHit = {
  hitId?: string;
  summary?: string;
  resource?: {
    'id'?: string;
    'name'?: string;
    'webUrl'?: string;
    'lastModifiedDateTime'?: string;
    'parentReference'?: { driveId?: string; siteId?: string };
    'lastModifiedBy'?: { user?: { displayName?: string } };
    '@odata.type'?: string;
  };
};

function fileTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const connectors = ['sharepoint', 'onedrive'].filter(slug => microsoftInScope(ctx, slug));
  const search = tool(
    async args => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, connectors);
      const size = Math.min(Math.max(args.limit ?? 10, 1), 25);
      const body = await graphJson<{ value?: Array<{ hitsContainers?: Array<{ hits?: SearchHit[]; total?: number }> }> }>(token, {
        path: '/search/query',
        method: 'POST',
        what: 'Microsoft 365 file search',
        body: { requests: [{ entityTypes: ['driveItem'], query: { queryString: args.query }, from: 0, size }] },
      });
      const hits = body.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
      return {
        files: hits.map(hit => ({
          name: hit.resource?.name ?? null,
          driveId: hit.resource?.parentReference?.driveId ?? null,
          itemId: hit.resource?.id ?? hit.hitId ?? null,
          webUrl: hit.resource?.webUrl ?? null,
          modifiedAt: hit.resource?.lastModifiedDateTime ?? null,
          modifiedBy: hit.resource?.lastModifiedBy?.user?.displayName ?? null,
          snippet: (hit.summary ?? '').replace(/<\/?c0>/g, ''),
        })),
        note: 'Read a file\'s text with microsoft_file_read (drive_id, item_id).',
      };
    }),
    {
      name: 'microsoft_files_search',
      description: 'Search OneDrive and SharePoint LIVE (Microsoft 365 search, everything the connected account can open): names and file contents. Returns each file with its drive_id and item_id, a link, who last changed it and when, and a snippet. Then read one with microsoft_file_read.',
      schema: z.object({
        query: z.string().min(1).describe('What to search for: words in the file, its name, a client or project.'),
        limit: z.number().int().optional().describe('How many files, 1-25 (default 10).'),
      }),
    },
  );

  const read = tool(
    async args => answer(async () => {
      const token = await tokenOrThrow(ctx.orgId, connectors);
      const drivePath = `/drives/${encodeURIComponent(args.drive_id)}`;
      const item = await graphJson<{ id: string; name: string; size?: number; webUrl?: string; lastModifiedDateTime?: string; file?: { mimeType?: string } }>(token, {
        path: `${drivePath}/items/${encodeURIComponent(args.item_id)}?$select=id,name,size,webUrl,lastModifiedDateTime,file`,
        what: 'a OneDrive or SharePoint file',
      });
      if (!item.file) {
        throw new Error(`"${item.name}" is a folder, not a file.`);
      }
      const text = await readDriveItemText(token, drivePath, item);
      const cut = text.length > FILE_TEXT_MAX;
      return {
        name: item.name,
        webUrl: item.webUrl ?? null,
        modifiedAt: item.lastModifiedDateTime ?? null,
        text: cut ? text.slice(0, FILE_TEXT_MAX) : text,
        ...(cut ? { note: `Cut at ${FILE_TEXT_MAX} characters of ${text.length}.` } : {}),
        ...(text ? {} : { note: 'This file has no text Vocion can read (an image, an archive, or a file too large); open it with webUrl.' }),
      };
    }),
    {
      name: 'microsoft_file_read',
      description: 'Read the text of one OneDrive or SharePoint file LIVE: Word, Excel, PowerPoint and PDF (rendered by Microsoft), or plain text. Take drive_id and item_id from microsoft_files_search.',
      schema: z.object({
        drive_id: z.string().min(1).describe('The file\'s driveId.'),
        item_id: z.string().min(1).describe('The file\'s item id.'),
      }),
    },
  );
  return [search, read];
}

/**
 * The Microsoft 365 read tools this agent's sources unlock; empty without one.
 * @param ctx - The turn.
 */
export function microsoft365Tools(ctx: RuntimeContext): StructuredToolInterface[] {
  return [
    ...(microsoftInScope(ctx, OUTLOOK_MAIL_SLUG) ? outlookTools(ctx) : []),
    ...(microsoftInScope(ctx, TEAMS_SLUG) ? teamsTools(ctx) : []),
    ...(microsoftInScope(ctx, 'sharepoint') || microsoftInScope(ctx, 'onedrive') ? fileTools(ctx) : []),
  ];
}
