/**
 * lookup_person — one person across the three connector families.
 *
 * A request's asker is a chat user id in the thread, an account id on the
 * issue, a login on the pull request: three directories, one person. "Who
 * asked" and "who to tell" need the three joined, and the only key the three
 * share is an email address. So this tool starts from an email (or from a
 * chat user id, whose directory can usually say the email) and asks each
 * family the agent reaches what it knows: the chat user, the tracker account,
 * the code-host login. A family the agent does not reach is said to be out
 * of scope rather than guessed at, and a directory that keeps its emails
 * private (GitHub, for most accounts) says so too.
 *
 * Read-only; present for any agent with a source of any of the three
 * families (`libs/connectors/families.ts`).
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourcesForOrg, familySourceSlugs } from '@/libs/connectors/families';

export const LOOKUP_PERSON_TOOL = 'lookup_person';

type Directory<T> = { ok: true; value: T | null } | { ok: false; error: string } | { ok: false; outOfScope: true };

/**
 * The person's chat user, by email or by id, when the agent reaches a chat.
 * @param ctx - The turn.
 * @param email - The email to look up, when known.
 * @param chatUserId - The chat user id, when the ask came from a thread.
 */
async function inChat(ctx: RuntimeContext, email: string | null, chatUserId: string | null): Promise<Directory<{ id: string; name: string | null; email: string | null }>> {
  if (!familyInScope(ctx, 'chat')) {
    return { ok: false, outOfScope: true };
  }
  try {
    const { chatProviderFor } = await import('@/services/chat/provider');
    const chat = await chatProviderFor(ctx.orgId);
    if (chatUserId) {
      return { ok: true, value: await chat.userInfo(chatUserId) };
    }
    if (email) {
      const found = await chat.findUserByEmail(email);
      return { ok: true, value: found ? { id: found.id, name: found.name, email } : null };
    }
    return { ok: true, value: null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * The person's account on each tracker the workspace connected, by email.
 * @param ctx - The turn.
 * @param email - The email to look up.
 */
async function inTrackers(ctx: RuntimeContext, email: string): Promise<Directory<Array<{ accountId: string; displayName: string }>>> {
  if (!familyInScope(ctx, 'tracker')) {
    return { ok: false, outOfScope: true };
  }
  try {
    const { trackerProvidersFor } = await import('@/services/tracker/provider');
    const providers = await trackerProvidersFor(ctx.orgId);
    const found = await Promise.all(providers.map(p => p.findUserByEmail(email).catch(() => null)));
    const hits = found.filter((f): f is { accountId: string; displayName: string } => f !== null);
    return { ok: true, value: hits.length > 0 ? hits : null };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * The person's login on the code host, by email, asked through the first
 * repository the agent's code-host sources list (the token is per repository).
 * @param ctx - The turn.
 * @param email - The email to look up.
 */
async function onCodeHost(ctx: RuntimeContext, email: string): Promise<Directory<{ login: string; url: string }>> {
  if (!familyInScope(ctx, 'repo')) {
    return { ok: false, outOfScope: true };
  }
  try {
    const sources = await familySourcesForOrg(ctx.orgId, 'repo', familySourceSlugs(ctx, 'repo'));
    const repo = sources.flatMap(s => (Array.isArray(s.config.repos) ? (s.config.repos as unknown[]).map(String) : []))[0];
    if (!repo) {
      return { ok: false, error: 'The code-host source lists no repository, so there is nothing to ask with.' };
    }
    const { repoProviderFor } = await import('@/services/repo/provider');
    const host = await repoProviderFor(ctx.orgId, repo);
    return { ok: true, value: await host.findUserByEmail(ctx.orgId, repo, email) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * The tool, present when the agent reaches any of the three families.
 * @param ctx - The turn.
 */
export function lookupPersonTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'chat') && !familyInScope(ctx, 'tracker') && !familyInScope(ctx, 'repo')) {
    return [];
  }
  return [tool(
    async (args) => {
      const chatUserId = args.chat_user_id?.trim() || null;
      let email = args.email?.trim().toLowerCase() || null;
      // A chat user id can usually be turned into an email by its own
      // directory; the other two directories are keyed on the email.
      const chat = await inChat(ctx, email, chatUserId);
      if (!email && chat.ok && chat.value?.email) {
        email = chat.value.email.toLowerCase();
      }
      if (!email) {
        return JSON.stringify({ ok: false, error: chatUserId
          ? 'The chat directory did not give this user\'s email, so the tracker and the code host cannot be asked. Ask the person, or look them up by email.'
          : 'Give an email, or a chat user id whose directory can say the email.' });
      }
      const [trackers, codeHost] = await Promise.all([inTrackers(ctx, email), onCodeHost(ctx, email)]);
      const describe = <T>(d: Directory<T>): T | null | string => (d.ok ? d.value : 'outOfScope' in d ? 'not in this agent\'s sources' : d.error);
      return JSON.stringify({
        ok: true,
        email,
        chat: describe(chat),
        tracker: describe(trackers),
        codeHost: describe(codeHost),
        note: 'A null means the directory was asked and had no account for this email; a sentence means it could not be asked. GitHub answers only for accounts whose email is public.',
      });
    },
    {
      name: LOOKUP_PERSON_TOOL,
      description: 'One person across the connected chat, issue tracker and code host: their chat user (id and name), their tracker account (id and display name) and their code-host login, found by email. Give an email, or a chat user id from a thread (its directory usually gives the email). Use it to say who asked and where to tell them; never to guess an identity from a name.',
      schema: z.object({
        email: z.string().email().optional().describe('The person\'s email.'),
        chat_user_id: z.string().min(1).optional().describe('Their user id on the connected chat (a Slack user id from a thread), when the email is not known.'),
      }),
    },
  )];
}
