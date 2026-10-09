/**
 * `deck.create` — make a presentation (or a document, or a web page) from the agent's words, in
 * the workspace's own Gamma account (`libs/gamma/client.ts`), and hand back its link.
 *
 * It spends the account's Gamma credits and leaves a deck there, which Gamma's API cannot delete,
 * so there is no Undo: the deck stays in Gamma, where a person can delete it. External, so the
 * trust ladder decides whether an agent's deck waits for a person; a person asking for one runs.
 */

import type { Action, ReviewCard } from './types';
import { z } from 'zod';

export const DECK_CREATE_ACTION_ID = 'deck.create';

const deckInput = z.object({
  title: z.string().min(1).max(200).describe('What the deck is, as its first card says it.'),
  content: z.string().min(1).max(100_000).describe('The text the deck is made from: an outline, notes or a whole document.'),
  format: z.enum(['presentation', 'document', 'webpage']).optional().describe('Default presentation.'),
  numCards: z.number().int().min(1).max(60).optional().describe('How many cards (default 10).'),
  textMode: z.enum(['generate', 'condense', 'preserve']).optional().describe('generate expands short notes, condense shortens long text, preserve keeps the words (default condense).'),
  instructions: z.string().max(2000).optional().describe('Tone, audience, what to emphasise.'),
  exportAs: z.enum(['pdf', 'pptx']).optional().describe('Also export a file.'),
});

export const deckCreateAction: Action<typeof deckInput> = {
  id: DECK_CREATE_ACTION_ID,
  name: 'Make a deck',
  description: 'Make a presentation, document or web page from text in the workspace\'s Gamma account and return its link. Spends Gamma credits; the deck stays in Gamma (no Undo).',
  inputSchema: deckInput,
  grant: 'create_document',
  external: true,
  dedupKeyFor: input => `${DECK_CREATE_ACTION_ID}:${input.title}`.toLowerCase(),
  async precheck(ctx) {
    const { gammaKeyFor } = await import('@/libs/gamma/client');
    if (!(await gammaKeyFor(ctx.orgId))) {
      return 'This workspace has no Gamma account connected. Connect Gamma at /dashboard/connectors and propose again.';
    }
    return undefined;
  },
  async reviewCard(_ctx, input): Promise<ReviewCard> {
    const format = input.format ?? 'presentation';
    return {
      title: `Make a ${format} — ${input.title}`,
      system: 'Gamma',
      headline: `Approving makes a ${input.numCards ?? 10}-card ${format} in Gamma now, spending Gamma credits. The deck stays in Gamma.`,
      badges: [{ label: 'Gamma' }, { label: 'Spends credits' }],
      contentHeading: { label: 'Made from' },
      content: [{ kind: 'text', id: 'content', label: 'Content', body: input.content }],
      fields: [
        { label: 'Format', value: format },
        { label: 'Cards', value: String(input.numCards ?? 10) },
        ...(input.instructions ? [{ label: 'Instructions', value: input.instructions }] : []),
        ...(input.exportAs ? [{ label: 'Export', value: input.exportAs }] : []),
      ],
      nextAction: `Approving makes the ${format} in Gamma and links it here.`,
      verbs: { approve: 'Make it', reject: 'Not now' },
    };
  },
  async execute(ctx, input) {
    const { createGeneration, gammaKeyFor, waitForGeneration } = await import('@/libs/gamma/client');
    const apiKey = await gammaKeyFor(ctx.orgId);
    if (!apiKey) {
      throw new Error('This workspace has no Gamma account connected. Connect Gamma at /dashboard/connectors.');
    }
    const { generationId } = await createGeneration(apiKey, {
      inputText: `# ${input.title}\n\n${input.content}`,
      textMode: input.textMode ?? 'condense',
      format: input.format ?? 'presentation',
      numCards: input.numCards ?? 10,
      ...(input.exportAs ? { exportAs: input.exportAs } : {}),
      ...(input.instructions ? { additionalInstructions: input.instructions } : {}),
    });
    const done = await waitForGeneration(apiKey, generationId, { maxWaitMs: 240_000 });
    if (done.status !== 'completed') {
      throw new Error(`Gamma did not finish the deck: ${done.error ?? done.status}. Generation ${generationId}.`);
    }
    const url = done.gammaUrl ?? null;
    return { created: true, generationId, url, exportUrl: done.exportUrl ?? null, credits: done.credits ?? null, line: url ? `Made "${input.title}" in Gamma: ${url}` : `Made "${input.title}" in Gamma (generation ${generationId}).` };
  },
};
