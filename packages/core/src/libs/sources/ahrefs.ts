/**
 * Ahrefs connector — the capability carrier for the Ahrefs tools
 * (`ahrefs_organic_keywords`, `ahrefs_brand_radar`) and for the keyword
 * numbers `keyword_metrics` prefers when a workspace has Ahrefs. Nothing is
 * mirrored: every read is live, on the workspace's own Ahrefs plan.
 *
 * Auth: an Ahrefs API key (the `ahrefs` platform). Ahrefs offers no sign-in
 * for API access, so the key is the way to connect it.
 */

import type { ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { InspectInputError } from './inspect';

export const ahrefsConfigSchema = z.object({});

type Limits = { limits_and_usage?: { subscription?: string; units_limit_workspace?: number | null; units_usage_workspace?: number | null; usage_reset_date?: string | null } };

/**
 * Test connection: Ahrefs' limits-and-usage read, which costs no API units
 * and proves the key. Nothing is saved.
 * @param input - The credential, as typed or as vaulted.
 * @param input.credentials - `{ apiKey }`.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectAhrefs(input: { credentials: Record<string, unknown> }, doFetch: typeof fetch = fetch): Promise<ConnectorInspection> {
  const key = typeof input.credentials.apiKey === 'string' ? input.credentials.apiKey.trim() : '';
  if (!key) {
    throw new InspectInputError('Paste the Ahrefs API key, from Ahrefs → Account settings → API keys.');
  }
  try {
    const res = await doFetch('https://api.ahrefs.com/v3/subscription-info/limits-and-usage', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      const { ahrefsRefusal } = await import('@/libs/tools/serp/ahrefs');
      const message = ahrefsRefusal(res.status, (await res.text().catch(() => '')).slice(0, 200));
      return { reachable: true, authorized: res.status !== 401, checks: [{ key: 'key', label: 'Reads the Ahrefs plan', ok: false, detail: message }], note: null, error: message };
    }
    const usage = ((await res.json()) as Limits).limits_and_usage ?? {};
    const units = typeof usage.units_limit_workspace === 'number'
      ? ` ${(usage.units_usage_workspace ?? 0).toLocaleString('en-US')} of ${usage.units_limit_workspace.toLocaleString('en-US')} API units used${usage.usage_reset_date ? `, resetting ${usage.usage_reset_date.slice(0, 10)}` : ''}.`
      : '';
    return { reachable: true, authorized: true, checks: [{ key: 'key', label: 'Reads the Ahrefs plan', ok: true, detail: `${usage.subscription ? `Plan: ${usage.subscription}.` : 'The key works.'}${units}` }], note: 'This check spends no API units. Nothing was saved.', error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, authorized: false, checks: [], note: null, error: `Ahrefs did not answer: ${message}` };
  }
}

export const ahrefsConnector: SourceConnector<typeof ahrefsConfigSchema> = {
  slug: 'ahrefs',
  name: 'Ahrefs',
  description: 'Your Ahrefs numbers, read live: keyword volume, difficulty and traffic potential, the keywords a domain ranks for, and the AI answers that mention a brand (Brand Radar). Uses your Ahrefs plan\'s API units.',
  icon: 'Radar',
  category: 'data-analytics',
  brand: 'ahrefs',
  authKind: 'apikey',
  syncless: true,
  configSchema: ahrefsConfigSchema,
  inspectNote: 'Reads your Ahrefs plan and API units once. Spends no units; nothing is saved.',

  async inspect({ credentials }) {
    return inspectAhrefs({ credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Read live by the Ahrefs tools, never mirrored.
  },
};
