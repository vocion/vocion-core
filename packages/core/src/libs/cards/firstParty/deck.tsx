/**
 * deck Card — a 16:9 presentation the agent wrote with `render_deck`.
 *
 * Two surfaces, one artifact, like the document card: the chat surface says
 * what it is (title, slide count, whether the last render-verify passed,
 * whether a sceptical buyer has read it, the first slide); the artifact
 * surface shows every slide as verified, numbered, with the PDF. Both read
 * the receipt on the version, never a second render.
 */

import type { DeckSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { z } from 'zod';
import { DeckSummary, DeckThumbnails } from '@/features/dashboard/artifacts/DeckView';
import { deckVerificationSchema, documentRedTeamSchema } from '../specs';

export const DECK_SLUG = 'deck';

/**
 * The card reads only what it shows, so a pending shell (an empty spec) and
 * a partial payload still render; the stored spec is validated on write.
 */
const deckCardSchema = z.object({
  title: z.string().optional(),
  order: z.array(z.string()).optional(),
  verification: deckVerificationSchema.optional(),
  redTeam: documentRedTeamSchema.optional(),
  __artifactId: z.number().int().positive().optional(),
}).passthrough();
type DeckCardData = Partial<DeckSpec> & { __artifactId?: number };

export function DeckCardView({ data, surface }: { data: DeckCardData; surface: string }) {
  const props = { title: data.title ?? 'Deck', slideCount: data.order?.length, verification: data.verification, redTeam: data.redTeam };
  return surface === 'artifact' ? <DeckThumbnails {...props} /> : <DeckSummary {...props} />;
}

export const deckCard = defineCard({
  slug: DECK_SLUG,
  name: 'Deck',
  description: 'A 16:9 presentation deck (vocion-deck/1) — a proposal, concept or case study — shown as its render-verified slides, with its verdict and its PDF.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: deckCardSchema,
  Renderer: ({ data, surface }) => <DeckCardView data={data as DeckCardData} surface={surface} />,
});
