/**
 * page_context — what the person is looking at while they ask.
 *
 * The SSE route already appends a compact "where I am" note under each
 * message. This tool returns the same object as JSON so the model can work
 * from it deliberately: pull the record id before calling a lookup tool,
 * quote the highlighted passage exactly, or link the chip the person came
 * from. Read-only; nothing here reaches the database.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function pageContextTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const pc = ctx.pageContext;
      if (!pc) {
        return JSON.stringify({ present: false, note: 'No page context for this turn — the person asked from a context-free surface (API, schedule, or the full-page chat with nothing selected).' });
      }
      return JSON.stringify({ present: true, ...pc });
    },
    {
      name: 'page_context',
      description: 'Return where the person is in the app for THIS turn as JSON: page path and title, the record the page is about ({type, id, label, href}), any records they @-mentioned, and the passage they highlighted. Call it before acting on "this"/"here"/"it" so you work from the exact record instead of guessing.',
      schema: z.object({}),
    },
  );
}
