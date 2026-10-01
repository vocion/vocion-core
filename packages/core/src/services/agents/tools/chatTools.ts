/**
 * The chat family's reads — the thread an ask came from, and a file somebody
 * attached to it — for any agent whose sources include a chat
 * (`familyInScope(ctx, 'chat')`, `libs/connectors/families.ts`).
 *
 * WHY: the knowledge index holds a chat's messages as searchable documents,
 * not as threads — who replied to whom, in what order, with which screenshot
 * is lost at ingestion. A product manager filing a request from a thread, or
 * a designer drawing from the asker's screenshot, needs the thread itself, so
 * the family reads it live with the token that is in that chat
 * (`services/chat/provider.ts`). The writes are actions, not tools:
 * `chat.reply_in_thread` and `chat.add_reaction` through `propose_action`, so
 * the trust ladder, the ledger and Undo apply.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope } from '@/libs/connectors/families';

export const CHAT_READ_THREAD_TOOL = 'chat_read_thread';
export const CHAT_READ_FILE_TOOL = 'chat_read_file';

/** Text the model can read whole; past this the file is cut once and says so. */
const TEXT_MAX = 60_000;
const TEXT_TYPES = /^(?:text\/|application\/(?:json|x-ndjson|xml|yaml|x-yaml|csv))/i;
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

export function chatTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'chat')) {
    return [];
  }
  return [readThreadTool(ctx), readFileTool(ctx)];
}

function readThreadTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { chatProviderFor, messageRefOf } = await import('@/services/chat/provider');
        const ref = messageRefOf({ permalink: args.permalink, channelId: args.channel_id, ts: args.ts });
        if (!ref) {
          return JSON.stringify({ ok: false, error: 'Name the message: a permalink to it, or channel_id and ts.' });
        }
        const provider = await chatProviderFor(ctx.orgId);
        const read = await provider.readThread({ channelId: ref.channelId, threadTs: ref.threadTs ?? ref.ts, limit: args.limit ?? 50 });
        if (!read.ok) {
          return JSON.stringify({ ok: false, error: read.error });
        }
        const { channel, messages } = read.value;
        return JSON.stringify({
          ok: true,
          channel,
          threadTs: ref.threadTs ?? ref.ts,
          messages,
          note: messages.some(m => m.files.length > 0)
            ? 'Read an attached file with chat_read_file and its id. Reply in this thread with propose_action chat.reply_in_thread; mark the message with chat.add_reaction.'
            : 'Reply in this thread with propose_action chat.reply_in_thread; mark the message with chat.add_reaction.',
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: CHAT_READ_THREAD_TOOL,
      description: 'A thread in the connected chat, read live: the channel, then every message oldest first with its author, text, id and attached files. Give a permalink to any message in it, or the channel id and the message\'s id. Use it to read an ask as it was written, with who asked and what they attached, before filing or answering it.',
      schema: z.object({
        permalink: z.string().url().optional().describe('A link to a message in the thread, as the chat writes it (Slack: https://<team>.slack.com/archives/<channel>/p<digits>).'),
        channel_id: z.string().optional().describe('The channel, when giving ids instead of a link.'),
        ts: z.string().optional().describe('The message\'s id in that channel (Slack: its ts, e.g. 1727700000.000100).'),
        limit: z.number().int().min(1).max(100).optional().describe('How many messages to read (default 50).'),
      }),
    },
  );
}

function readFileTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const { chatProviderFor, messageRefOf } = await import('@/services/chat/provider');
        const provider = await chatProviderFor(ctx.orgId);
        let fileId = args.file_id ?? null;
        if (!fileId) {
          const ref = messageRefOf({ permalink: args.permalink });
          if (!ref) {
            return JSON.stringify({ ok: false, error: 'Name the file: its id (from chat_read_thread), or a permalink to the message that carries it.' });
          }
          const read = await provider.readThread({ channelId: ref.channelId, threadTs: ref.threadTs ?? ref.ts, limit: 100 });
          if (!read.ok) {
            return JSON.stringify({ ok: false, error: read.error });
          }
          const message = read.value.messages.find(m => m.ts === ref.ts) ?? read.value.messages[0];
          const files = message?.files ?? [];
          if (files.length !== 1) {
            return JSON.stringify({ ok: false, error: files.length === 0 ? 'That message carries no file.' : `That message carries ${files.length} files; name one by file_id.`, files });
          }
          fileId = files[0]!.id;
        }
        const got = await provider.readFile(fileId);
        if (!got.ok) {
          return JSON.stringify({ ok: false, error: got.error });
        }
        const file = got.value;
        if (IMAGE_EXT[file.mimeType]) {
          const { saveArtifact } = await import('@/libs/tools/artifacts/store');
          const saved = await saveArtifact({ orgId: ctx.orgId, data: file.bytes, ext: IMAGE_EXT[file.mimeType]!, contentType: file.mimeType });
          return JSON.stringify({ ok: true, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, url: saved.url, note: 'Stored as an image in this workspace; open it by its url, or hand the url to draw_mockup as a reference.' });
        }
        if (TEXT_TYPES.test(file.mimeType)) {
          const text = file.bytes.toString('utf8');
          const shown = text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n\n[Cut at ${TEXT_MAX} of ${text.length} characters.]` : text;
          return JSON.stringify({ ok: true, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, text: shown });
        }
        return JSON.stringify({ ok: true, id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, note: `A ${file.mimeType} file cannot be read inline here; say what it is and ask the person for the content you need from it.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: CHAT_READ_FILE_TOOL,
      description: 'A file attached to a message in the connected chat, downloaded with the chat\'s own token. An image is stored in this workspace and its url returned (a reference for draw_mockup); a text, markdown, CSV or JSON file is returned as text; anything else is described. Give the file id from chat_read_thread, or a permalink to a message that carries exactly one file.',
      schema: z.object({
        file_id: z.string().optional().describe('The file\'s id, from chat_read_thread.'),
        permalink: z.string().url().optional().describe('A link to the message carrying the file, when it carries one file.'),
      }),
    },
  );
}
