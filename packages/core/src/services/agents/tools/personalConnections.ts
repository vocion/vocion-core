/**
 * The person's own systems, read by their own assistant — mail, calendar,
 * files, Slack DMs and GitHub (docs/guides/personal-connections.md).
 *
 * Present only in a personal workspace with a person in the turn. Every call
 * reads that person's OWN login through `personalCredential`, which refuses
 * any workspace that is not theirs, any Org that turned personal connections
 * off, and any connection they have not made — so one person's grant can
 * never answer another person's turn, and a shared workspace never reaches
 * one. Nothing here falls back to a workspace's source or the server's key.
 *
 * The tools are present whether or not the person has connected the system
 * yet: a call to one they have not connected answers with the sentence that
 * says so and where to connect it, which is what the person needs to hear.
 *
 * Read-only, except `mail_draft_reply`, which writes a draft into the
 * person's own Gmail Drafts and never sends (`libs/personal/google.ts`). A
 * draft leaves nothing outside the person's own mailbox, so it is theirs to
 * ask for and needs no card.
 */
import type { RuntimeContext } from '../types';
import type { PersonalCredential } from '@/services/personal/connections';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { isBrokenConnection } from '@/libs/personal/broken';
import { githubMyWork, githubRead, parseGithubRef, usableGithubToken } from '@/libs/personal/github';
import { calendarEvents, driveRead, driveSearch, mailDraftReply, mailRead, mailSearch } from '@/libs/personal/google';
import { slackDmSearch } from '@/libs/personal/slack';
import { DEFAULT_TIME_ZONE, formatDateTime, startOfDay } from '@/libs/time/zone';
import { personalCredential } from '@/services/personal/connections';
import { reportBrokenConnection } from '@/services/personal/urgent';
import { dayWindow, renderCalendar } from './calendarEvents';

/**
 * A failed call as a sentence for the turn: the person hears why, and nothing
 * is made up in its place. A vendor's message never carries a token.
 * @param what - What could not be read.
 * @param error - What was thrown.
 */
function couldNot(what: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : 'unknown error';
  return `Could not ${what}: ${reason}. Say so plainly; do not fill the gap from memory or another source.`;
}

/**
 * Run a tool body with the person's own credential for one connection, or
 * answer with why there is none.
 * @param ctx - The turn.
 * @param connector - The connection's connector slug.
 * @param body - What to do with the credential.
 */
async function withOwn(ctx: RuntimeContext, connector: string, body: (cred: Extract<PersonalCredential, { ok: true }>, fail: (what: string, error: unknown) => string) => Promise<string>): Promise<string> {
  const cred = await personalCredential({ orgId: ctx.orgId, userId: ctx.userId ?? '', connector });
  if (!cred.ok) {
    return cred.why;
  }
  // A failure that only reconnecting fixes is also told to the person, once a
  // day, where they chose to hear it (`services/personal/urgent.ts`).
  const fail = (what: string, error: unknown): string => {
    if (isBrokenConnection(error)) {
      void reportBrokenConnection({ orgId: cred.orgId, userId: ctx.userId ?? '', connector });
    }
    return couldNot(what, error);
  };
  return body(cred, fail);
}

/**
 * The person's own-systems tools, in their personal workspace only.
 * @param ctx - The turn.
 */
export function personalConnectionTools(ctx: RuntimeContext) {
  if (ctx.workspaceKind !== 'personal' || !ctx.userId) {
    return [];
  }
  const tz = () => ctx.timeZone ?? DEFAULT_TIME_ZONE;

  const mail_search = tool(
    async ({ query, max }) => withOwn(ctx, 'gmail', async (cred, fail) => {
      try {
        const hits = await mailSearch({ orgId: cred.orgId, values: cred.values }, query, max ?? 10);
        if (hits.length === 0) {
          return `No mail matched "${query}". Say exactly that.`;
        }
        return [`${hits.length} message(s) matched "${query}", newest first (read live from your Gmail):`, ...hits.map(h => `- ${h.unread ? '[unread] ' : ''}${h.subject} — from ${h.from} · ${h.date} · message_id ${h.id} · thread_id ${h.threadId}\n  ${h.snippet}`)].join('\n');
      } catch (error) {
        return fail('search your mail', error);
      }
    }),
    {
      name: 'mail_search',
      description: 'Search the person\'s OWN Gmail, live, with Gmail\'s query language (e.g. "from:dana@northwind.example newer_than:7d", "is:unread in:inbox", "subject:renewal"). Returns sender, subject, date, snippet and the ids mail_read and mail_draft_reply take.',
      schema: z.object({
        query: z.string().min(1).describe('A Gmail search query.'),
        max: z.number().int().min(1).max(25).optional().describe('How many messages (default 10).'),
      }),
    },
  );

  const mail_read = tool(
    async ({ thread_id, message_id }) => withOwn(ctx, 'gmail', async (cred, fail) => {
      if (!thread_id && !message_id) {
        return 'Pass thread_id or message_id.';
      }
      try {
        const thread = await mailRead({ orgId: cred.orgId, values: cred.values }, { threadId: thread_id, messageId: message_id });
        if (!thread) {
          return 'Gmail has no such thread in your mailbox.';
        }
        return `${thread.title} (thread_id ${thread.threadId}, read live)${thread.truncated ? ' — long thread, cut to its first part' : ''}\n\n${thread.content}`;
      } catch (error) {
        return fail('read that thread', error);
      }
    }),
    {
      name: 'mail_read',
      description: 'Read one whole thread from the person\'s OWN Gmail — every message with its headers and body — by thread_id or any message_id in it (from mail_search).',
      schema: z.object({
        thread_id: z.string().optional().describe('The thread id.'),
        message_id: z.string().optional().describe('Any message id in the thread.'),
      }),
    },
  );

  const mail_draft_reply = tool(
    async ({ thread_id, message_id, body, to, cc }) => withOwn(ctx, 'gmail', async (cred, fail) => {
      if (!thread_id && !message_id) {
        return 'Pass the thread_id or message_id of the mail to reply to.';
      }
      try {
        const draft = await mailDraftReply({ orgId: cred.orgId, values: cred.values }, { threadId: thread_id, messageId: message_id, body, to, cc });
        if (!draft) {
          return 'Gmail has no such message to reply to; no draft was written.';
        }
        return `Draft written to your Gmail Drafts — NOT sent. To: ${draft.to} · Subject: ${draft.subject} · draft ${draft.draftId}. Open Drafts to review and send it yourself: ${draft.link}. Tell the person it is a draft waiting for them, never that it was sent.`;
      } catch (error) {
        return fail('write the draft', error);
      }
    }),
    {
      name: 'mail_draft_reply',
      description: 'Write a reply into the person\'s OWN Gmail Drafts, threaded under the mail it answers. It NEVER sends: the person reviews and sends from Gmail. Use when they ask you to reply to, answer or draft a response to an email.',
      schema: z.object({
        thread_id: z.string().optional().describe('The thread to reply in; its newest message is answered.'),
        message_id: z.string().optional().describe('Or the exact message to answer.'),
        body: z.string().min(1).max(20_000).describe('The reply, plain text, in the person\'s voice. No signature unless they use one.'),
        to: z.string().optional().describe('Override the recipient; defaults to the sender (or their Reply-To).'),
        cc: z.string().optional().describe('Anyone to copy, comma-separated.'),
      }),
    },
  );

  const calendarIn = async (cred: Extract<PersonalCredential, { ok: true }>, fail: (what: string, error: unknown) => string, timeMin: string, timeMax: string, label: string): Promise<string> => {
    try {
      const events = await calendarEvents({ orgId: cred.orgId, values: cred.values }, timeMin, timeMax);
      return renderCalendar(events, new Date(), label, tz());
    } catch (error) {
      return fail('read your calendar', error);
    }
  };

  const calendar_today = tool(
    async () => withOwn(ctx, 'google-calendar', async (cred, fail) => {
      const { timeMin, timeMax, label } = dayWindow(undefined, new Date(), tz());
      return calendarIn(cred, fail, timeMin, timeMax, label);
    }),
    {
      name: 'calendar_today',
      description: 'Read the person\'s OWN Google Calendar for today, live: what is still ahead and what already happened, each with how far away it is. The only source of truth for their day.',
      schema: z.object({}),
    },
  );

  const calendar_range = tool(
    async ({ from, to }) => withOwn(ctx, 'google-calendar', async (cred, fail) => {
      const zone = tz();
      const start = startOfDay(from, zone);
      const endDay = dayWindow(to ?? from, new Date(), zone);
      if (Number.isNaN(start.getTime()) || new Date(endDay.timeMax) <= start) {
        return 'Give the range as YYYY-MM-DD, with `to` on or after `from`.';
      }
      if (new Date(endDay.timeMax).getTime() - start.getTime() > 31 * 86_400_000) {
        return 'Read at most 31 days at a time.';
      }
      return calendarIn(cred, fail, start.toISOString(), endDay.timeMax, `${formatDateTime(start, zone)} to the end of ${to ?? from} (${zone})`);
    }),
    {
      name: 'calendar_range',
      description: 'Read the person\'s OWN Google Calendar for a span of days, live (up to 31 days). Use for "this week", "next Tuesday", "before the board meeting".',
      schema: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('First day, YYYY-MM-DD, in the person\'s zone.'),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Last day, YYYY-MM-DD. Omit for one day.'),
      }),
    },
  );

  const drive_search = tool(
    async ({ query, max }) => withOwn(ctx, 'drive', async (cred, fail) => {
      try {
        const files = await driveSearch({ orgId: cred.orgId, values: cred.values }, query, max ?? 10);
        if (files.length === 0) {
          return `No files matched "${query}". Say exactly that.`;
        }
        return [`${files.length} file(s) matched "${query}", newest first (read live from your Drive):`, ...files.map(f => `- ${f.link ? `[${f.name}](${f.link})` : f.name} · ${f.mimeType} · modified ${f.modified ?? 'unknown'}${f.owner ? ` · owner ${f.owner}` : ''} · file_id ${f.id}`)].join('\n');
      } catch (error) {
        return fail('search your Drive', error);
      }
    }),
    {
      name: 'drive_search',
      description: 'Find files in the person\'s OWN Google Drive by words in their name or contents, newest first. Returns links and the file_id drive_read takes.',
      schema: z.object({
        query: z.string().min(1).describe('Words to find.'),
        max: z.number().int().min(1).max(25).optional().describe('How many files (default 10).'),
      }),
    },
  );

  const drive_read = tool(
    async ({ file_id }) => withOwn(ctx, 'drive', async (cred, fail) => {
      try {
        const file = await driveRead({ orgId: cred.orgId, values: cred.values }, file_id);
        if (!file.ok) {
          return `${file.name}: ${file.why}${file.link ? ` ${file.link}` : ''}`;
        }
        return `${file.link ? `[${file.name}](${file.link})` : file.name} (read live)${file.truncated ? ' — long file, cut to its first part' : ''}\n\n${file.text}`;
      } catch (error) {
        return fail('read that file', error);
      }
    }),
    {
      name: 'drive_read',
      description: 'Read one file from the person\'s OWN Google Drive as text — a Doc, Sheet or Slides deck, or a text file — by file_id from drive_search.',
      schema: z.object({ file_id: z.string().min(1).describe('The file id.') }),
    },
  );

  const slack_dm_search = tool(
    async ({ query, max }) => withOwn(ctx, 'slack', async (cred, fail) => {
      const token = typeof cred.values.token === 'string' ? cred.values.token : '';
      try {
        const hits = await slackDmSearch(token, query, max ?? 10);
        if (hits.length === 0) {
          return `No direct messages matched "${query}". Say exactly that.`;
        }
        return [`${hits.length} direct message(s) matched "${query}", newest first (read live, as you):`, ...hits.map(h => `- ${h.from}${h.with ? ` in ${h.with}` : ''} · ${h.at ? formatDateTime(new Date(h.at), tz()) : 'undated'}${h.link ? ` · ${h.link}` : ''}\n  ${h.text.replace(/\s+/g, ' ')}`)].join('\n');
      } catch (error) {
        return fail('search your Slack DMs', error);
      }
    }),
    {
      name: 'slack_dm_search',
      description: 'Search the person\'s OWN Slack direct messages and group DMs, as them (channels are left out). Takes Slack search words and modifiers, e.g. "from:@dana renewal", "during:last-week".',
      schema: z.object({
        query: z.string().min(1).describe('Slack search words and modifiers.'),
        max: z.number().int().min(1).max(20).optional().describe('How many messages (default 10).'),
      }),
    },
  );

  const github_my_work = tool(
    async () => withOwn(ctx, 'github', async (cred, fail) => {
      try {
        const token = await usableGithubToken({ orgId: cred.orgId, tokenId: cred.tokenId, values: cred.values });
        const work = await githubMyWork(token);
        const section = (title: string, items: typeof work.reviewRequested) => [
          items.length > 0 ? `${title} (${items.length}):` : `${title}: none.`,
          ...items.map(i => `- [${i.title}](${i.url}) · ${i.ref}${i.author ? ` · by ${i.author}` : ''} · updated ${formatDateTime(new Date(i.updated), tz())}`),
        ];
        return ['Read live from GitHub, as you.', '', ...section('REVIEWS ASKED OF YOU', work.reviewRequested), '', ...section('YOUR OPEN PULL REQUESTS', work.authoredPulls), '', ...section('OPEN ISSUES ASSIGNED TO YOU', work.assignedIssues)].join('\n');
      } catch (error) {
        return fail('read your GitHub', error);
      }
    }),
    {
      name: 'github_my_work',
      description: 'What is on the person in their OWN GitHub, live: reviews asked of them, their open pull requests, and open issues assigned to them, each linked.',
      schema: z.object({}),
    },
  );

  const github_read = tool(
    async ({ ref }) => withOwn(ctx, 'github', async (cred, fail) => {
      const parsed = parseGithubRef(ref);
      if (!parsed) {
        return 'Name it as owner/repo#123 or paste its GitHub link.';
      }
      try {
        const token = await usableGithubToken({ orgId: cred.orgId, tokenId: cred.tokenId, values: cred.values });
        const t = await githubRead(token, parsed);
        return [
          `[${t.title}](${t.url}) · ${t.ref} · ${t.kind === 'pull' ? 'pull request' : 'issue'} · ${t.state}${t.author ? ` · by ${t.author}` : ''} (read live)`,
          '',
          t.body || '(no description)',
          ...(t.comments.length > 0 ? ['', `LATEST COMMENTS (${t.comments.length}):`, ...t.comments.map(c => `- ${c.author ?? 'someone'} · ${formatDateTime(new Date(c.at), tz())}: ${c.body.replace(/\s+/g, ' ')}`)] : []),
        ].join('\n');
      } catch (error) {
        return fail('read that from GitHub', error);
      }
    }),
    {
      name: 'github_read',
      description: 'Read one issue or pull request from GitHub as the person, with its latest comments, by owner/repo#number or its link.',
      schema: z.object({ ref: z.string().min(1).describe('owner/repo#123, or the issue or pull request URL.') }),
    },
  );

  return [mail_search, mail_read, mail_draft_reply, calendar_today, calendar_range, drive_search, drive_read, slack_dm_search, github_my_work, github_read];
}
