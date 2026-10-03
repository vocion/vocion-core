/**
 * Slate connector — the capability carrier for Slate as a video host, and
 * nothing else.
 *
 * Slate (MetaCTO's screen-recording product) ingests nothing into Vocion; it
 * is where the factory's QA and live-check recordings go to be watched, with
 * Slate's own player, transcript and sharing. What registering it buys is
 * everything around the token: a Slate tile on Connections, a place in the
 * encrypted vault, and — through `inspect` — a Test connection that says whose
 * account the token is and whether that account may upload.
 *
 * Optional: with no Slate connected, recordings stay in Vocion's media store
 * and play in the native player, exactly as before. See
 * `services/videoHost/` for how a filed recording is published.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { SlateFetch } from '@/libs/slate/client';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { readSlateMe, SLATE_API_BASE, SLATE_DEFAULT_VISIBILITY, SLATE_VISIBILITIES, SLATE_WEB_ORIGIN, slateCredentialsFrom } from '@/libs/slate/client';
import { InspectInputError } from './inspect';

const slateConfigSchema = z.object({
  /** Who may watch an uploaded recording. `team` is the uploader's Slate organization. */
  visibility: z.enum(SLATE_VISIBILITIES).default(SLATE_DEFAULT_VISIBILITY),
  /** API origin override, for a non-production Slate or a test double. */
  apiBase: z.string().url().default(SLATE_API_BASE),
  /** Web origin the player and watch page are served from. */
  webOrigin: z.string().url().default(SLATE_WEB_ORIGIN),
});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: who the token is, and whether the account may upload.
 * Read-only and free. Nothing is saved.
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
  const checks = [
    check('account', 'Token accepted', true, `Signed in as ${who}.`),
    check('uploads', 'May upload recordings (paid seat)', me.data.paidSeat === true, me.data.paidSeat === true
      ? 'Recordings the factory files will be uploaded here.'
      : 'This account has no paid seat, and Slate keeps uploading a file for paid seats. Recordings stay in Vocion until it has one.'),
  ];
  const visibility = typeof input.config.visibility === 'string' ? input.config.visibility : SLATE_DEFAULT_VISIBILITY;
  return {
    reachable: true,
    authorized: true,
    checks,
    note: `Uploads are visible to: ${visibility}${visibility === 'team' ? ' (this account\'s Slate organization)' : ''}. Nothing was saved by this test.`,
    error: checks.some(c => !c.ok) ? checks.filter(c => !c.ok).map(c => c.detail).join(' ') : null,
  };
}

export const slateConnector: SourceConnector<typeof slateConfigSchema> = {
  slug: 'slate',
  name: 'Slate',
  description: 'Screen recordings with a player, transcript and sharing. When connected, the factory\'s QA and live-check recordings are uploaded and play on the feature page in Slate\'s player.',
  icon: 'Video',
  authKind: 'apikey',
  syncless: true,
  configSchema: slateConfigSchema,
  inspectNote: 'Reads the account the token signs in as. Read-only and free. Nothing is saved.',

  async inspect({ config, credentials }) {
    return inspectSlate({ config, credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Slate is a destination, never mirrored into retrieval.
  },
};
