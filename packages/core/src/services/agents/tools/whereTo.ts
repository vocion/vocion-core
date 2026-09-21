/**
 * where_to — the exact page and click for something a person has to do in
 * Vocion, so the answer carries the link inline instead of describing a
 * screen from memory (`libs/navigation/whereTo.ts` has the why).
 *
 * Read-only, on for every agent. The chat renders a same-origin dashboard
 * link as a chip that navigates in place, so the line this returns is
 * already the affordance.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { findWhereTo, WHERE_TO, whereTo, whereToLine } from '@/libs/navigation/whereTo';

export function whereToTool(_ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const params = { id: args.id, slug: args.slug };
      if (args.intent) {
        const w = whereTo(args.intent);
        if (w) {
          return `${whereToLine(w, params)}\nPut that link inline in your reply, exactly as written.`;
        }
      }
      const hits = findWhereTo(args.query ?? args.intent ?? '');
      if (hits.length === 0) {
        return `No page in Vocion matches "${args.query ?? args.intent}". Known places:\n${WHERE_TO.map(w => `- ${w.intent}: ${w.label}`).join('\n')}`;
      }
      const top = hits.slice(0, 3);
      return [
        top.length === 1 ? 'The place:' : 'Best matches, most likely first:',
        ...top.map(w => `- ${whereToLine(w, params)}`),
        'Put the link inline in your reply, exactly as written.',
      ].join('\n');
    },
    {
      name: 'where_to',
      description: 'The exact Vocion page and click for something a person must do themselves — connect or re-authorise a system, fix a credential, approve a proposal, adopt a learning, open a data room. Returns a markdown link plus a one-line instruction; put the link inline in your reply. Call it BEFORE telling anyone where to go in Vocion.',
      schema: z.object({
        intent: z.string().optional().describe(`A known intent id: ${WHERE_TO.map(w => w.intent).join(', ')}.`),
        query: z.string().optional().describe('Or the words: "zoom scopes", "approve the email", "add a firecrawl key".'),
        id: z.string().optional().describe('A record id to fill into the link (a data room id).'),
        slug: z.string().optional().describe('A slug to fill into the link (a connector slug).'),
      }),
    },
  );
}
