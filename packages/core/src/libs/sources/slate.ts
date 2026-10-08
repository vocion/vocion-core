/**
 * Slate connector — Slate (MetaCTO's screen-recording product) as a
 * connection a workspace holds, and nothing more (Chris, 2026-10-03: "leave
 * it as a connector now").
 *
 * Slate ingests nothing into Vocion. What registering it buys is everything
 * around the token: a Slate tile on Connections, a place in the encrypted
 * vault, and — through `inspect` — a Test connection that says whose account
 * the token is. The factory's recordings stay in Vocion's media store and
 * play in Vocion's own player, with or without Slate connected.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { SlateFetch } from '@/libs/slate/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { readSlateMe, SLATE_API_BASE, slateCredentialsFrom } from '@/libs/slate/client';
import { InspectInputError } from './inspect';

const slateConfigSchema = z.object({
  /** API origin override, for a non-production Slate or a test double. */
  apiBase: z.string().url().default(SLATE_API_BASE),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: who the token is. Read-only and free. Nothing is saved.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.config - The source config.
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectSlate(input: { config: Record<string, unknown>; credentials: Record<string, unknown> }, doFetch?: SlateFetch): Promise<ConnectorInspection> {
  const parsed = slateCredentialsFrom(input.credentials, input.config);
  if (!parsed.ok) {
    throw new InspectInputError(parsed.message);
  }
  const me = await readSlateMe(parsed.credentials, doFetch);
  if (!me.ok) {
    return { reachable: me.status !== null, authorized: false, checks: [check('account', 'Token accepted', false, me.message)], note: null, error: me.message };
  }
  const who = me.data.name ? `${me.data.name} (${me.data.email ?? 'no email'})` : (me.data.email ?? 'an account with no email');
  return {
    reachable: true,
    authorized: true,
    checks: [check('account', 'Token accepted', true, `Signed in as ${who}.`)],
    note: 'Nothing was saved by this test.',
    error: null,
  };
}

export const slateConnector: SourceConnector<typeof slateConfigSchema> = {
  slug: 'slate',
  name: 'Slate',
  description: 'Screen recordings with a player, transcript and sharing. Connecting keeps the account\'s session token in the workspace vault and verifies it; nothing is synced.',
  icon: 'Video',
  brand: 'slate',
  authKind: 'apikey',
  syncless: true,
  configSchema: slateConfigSchema,
  inspectNote: 'Reads the account the token signs in as. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectSlate({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Slate is a connection, never mirrored into retrieval.
  },
};
