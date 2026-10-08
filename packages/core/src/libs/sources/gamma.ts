/**
 * Gamma connector — the carrier for the workspace's decks, and nothing else.
 *
 * Gamma is called, never mirrored: a deck is made when an agent's `deck.create` is approved
 * (`libs/actions/deck-create.ts`) or a person presses "Send to Gamma" on a proposal. So this
 * connector ingests nothing, the way ElevenLabs' does not. What registering it buys is
 * everything around the key: a tile on Connectors, offer-from-chat, a place in the vault, and a
 * Test connection that reads the account's themes — which spends no credits.
 */

import type { ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { GammaFetch } from '@/libs/gamma/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { gammaKeyFrom, listThemes } from '@/libs/gamma/client';
import { InspectInputError } from './inspect';

const gammaConfigSchema = z.object({});

/**
 * Test connection: the account's themes. Free.
 * @param input - The credential as typed or as vaulted.
 * @param input.credentials - The credential values.
 * @param fetchImpl - Injectable for tests.
 */
export async function inspectGamma(input: { credentials: Record<string, unknown> }, fetchImpl?: GammaFetch): Promise<ConnectorInspection> {
  const key = gammaKeyFrom(input.credentials);
  if (!key) {
    throw new InspectInputError('No Gamma API key. Make one in Gamma\'s settings → API key.');
  }
  try {
    const themes = await listThemes(key, fetchImpl);
    return {
      reachable: true,
      authorized: true,
      checks: [{ key: 'themes', label: 'Reads the account\'s themes', ok: true, detail: themes.length > 0 ? `${themes.length} theme${themes.length === 1 ? '' : 's'}: ${themes.slice(0, 5).map(t => t.name).join(', ')}${themes.length > 5 ? ', …' : ''}` : 'Gamma\'s default theme' }],
      note: 'Making a deck spends the account\'s Gamma credits; a test spends none.',
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reachable: !/could not be reached|fetch failed/i.test(message), authorized: !/refused the API key/.test(message), checks: [{ key: 'themes', label: 'Reads the account\'s themes', ok: false, detail: message }], note: null, error: message };
  }
}

export const gammaConnector: SourceConnector<typeof gammaConfigSchema> = {
  slug: 'gamma',
  name: 'Gamma',
  description: 'Decks, documents and web pages made from your agents\' work, in your own Gamma account. Nothing is synced.',
  icon: 'Presentation',
  brand: 'gamma',
  authKind: 'apikey',
  syncless: true,
  configSchema: gammaConfigSchema,
  inspectNote: 'Reads the account\'s themes. Free: no deck is made and no credit is spent.',
  async inspect({ credentials }) {
    return inspectGamma({ credentials });
  },
  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // A deck is made when asked, never mirrored.
  },
};
