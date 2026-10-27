/**
 * owed_on_account — everything not yet finished on our side for one client,
 * prospect or person, in one read (`services/accounts/owedOnAccount.ts`).
 *
 * "What do I owe on <client>?" is a join no other tool makes: the follow-up
 * another agent drafted after the call, the approved draft still sitting in
 * Gmail, the deck it attaches, the room's open items, the last call. A lead
 * that reads only its own tracker rows answers from the calendar and asks to
 * read the notes (2026-10-23). This tool reads every one of them by the
 * account's addresses, domains and project, and says the next move for each.
 */

import type { RuntimeContext } from '../types';
import type { OwedOnAccount } from '@/services/accounts/owedOnAccount';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { DEFAULT_TIME_ZONE, formatDate } from '@/libs/time/zone';
import { OWED_TOP, readOwedOnAccount } from '@/services/accounts/owedOnAccount';

export const OWED_ON_ACCOUNT_TOOL = 'owed_on_account';

const SECTION: Record<string, string> = {
  draft: 'Drafts waiting for you to send',
  review: 'In Review',
  follow_up: 'Follow-ups owed',
  room_item: 'Open items in the project',
  meeting: 'The last call',
};

/**
 * The read as the agent's text. Pure.
 * @param read - The read.
 * @param zone - The person's time zone.
 * @param link - Turns a Vocion path into the workspace's link.
 */
export function renderOwed(read: OwedOnAccount, zone: string, link: (path: string) => string = p => p): string {
  const { identity } = read;
  const who = [
    identity.room ? `project #${identity.room.id} "${identity.room.title}"${identity.matchedBy.length > 0 ? ` (matched on ${identity.matchedBy.join(', ')})` : ''}` : null,
    identity.domains.length > 0 ? `domains ${identity.domains.join(', ')}` : null,
    identity.emails.length > 0 ? `addresses ${identity.emails.slice(0, 6).join(', ')}${identity.emails.length > 6 ? ` +${identity.emails.length - 6}` : ''}` : null,
  ].filter(Boolean).join('; ');
  const lines: string[] = [`What is owed on "${identity.query}" — read by ${who || 'nothing it could match'}.`];
  if (read.items.length === 0) {
    lines.push('Nothing open: no pending Review items, unsent drafts, owed follow-ups or open room items touch this account.');
  }
  for (const section of ['draft', 'review', 'follow_up', 'room_item', 'meeting'] as const) {
    const rows = read.items.filter(i => i.section === section);
    if (rows.length === 0) {
      continue;
    }
    lines.push('', `${SECTION[section]} (${rows.length}):`);
    for (const r of rows.slice(0, OWED_TOP)) {
      const href = r.href ? (r.href.startsWith('http') ? r.href : link(r.href)) : null;
      lines.push(`- ${r.title} — ${r.status}; next: ${r.next}. ${formatDate(r.at, zone)}${r.by ? ` · from ${r.by}` : ''}${href ? ` · ${href}` : ''}${r.detail ? `\n  ${r.detail}` : ''}`);
    }
    if (rows.length > OWED_TOP) {
      lines.push(`- and ${rows.length - OWED_TOP} more`);
    }
  }
  if (read.artifacts.length > 0) {
    lines.push('', 'Newest decks and documents in the room:');
    for (const a of read.artifacts) {
      lines.push(`- #${a.id} ${a.title} (${a.kind})${a.updatedAt ? `, changed ${formatDate(a.updatedAt, zone)}` : ''} · ${link(a.href)}`);
    }
  }
  if (read.unavailable.length > 0) {
    lines.push('', `Not read: ${read.unavailable.join(' ')}`);
  }
  lines.push('', 'Answer from these rows: lead with what the person must do, each with its link. A draft waiting to be sent comes first. An attachment marked as the older version means the deck changed after its PDF was printed: say so.');
  return lines.join('\n');
}

/**
 * The tool, for any agent in a workspace.
 * @param ctx - The turn.
 */
export function owedOnAccountTools(ctx: RuntimeContext) {
  const owed = tool(
    async ({ account }: { account: string }) => {
      const read = await readOwedOnAccount({ orgId: ctx.orgId, about: account });
      return renderOwed(read, ctx.timeZone ?? DEFAULT_TIME_ZONE);
    },
    {
      name: OWED_ON_ACCOUNT_TOOL,
      metadata: { turnMemo: true },
      description: [
        'Everything not yet finished on our side for one client, prospect or person, in one read: pending Review items any agent raised about them (follow-up emails, post-call follow-up cards, CRM updates, failed runs to press again), approved Gmail drafts not yet sent, follow-up rows still owed, the project\'s open items and newest decks, and the last call with them — each with its status, its next move and its link.',
        'Call it FIRST for "what do I owe on X", "what is open with X", "where are we with X", "anything pending for X". Matched by the company\'s email domain, its contacts\' addresses and its project, never by a keyword search.',
        'Pass the company or person as the person named them, or better their email domain or an address.',
      ].join(' '),
      schema: z.object({
        account: z.string().min(2).max(200).describe('The company or person: "Kestrel", "kestrel.example", or "dana@kestrel.example"'),
      }),
    },
  );
  return [owed];
}
