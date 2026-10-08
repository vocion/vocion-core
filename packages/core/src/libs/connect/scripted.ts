/**
 * The scripted connect providers: a login that plays a written part.
 *
 * Proving "log in with GitHub" end to end against the real vendor costs an
 * app registration, a human at a consent screen and a network that can
 * answer. This is the stand-in, the same idea as the scripted chat model
 * (`libs/llm/scripted.ts`): the SCRIPT says what each vendor answers when the
 * callback asks it to turn the return into a credential, and everything on
 * our side is real: the start route, the signed state, the callback, the
 * credential vault, the login row, the source.
 *
 * On by `VOCION_CONNECT_SCRIPT=<path to a JSON file>`; refused in production
 * unless `VOCION_ALLOW_SCRIPTED_CONNECT=1` (the e2e job runs `next start`).
 * Read once per process and cached, like the scripted model's script.
 *
 * A provider the script does not name keeps its real id, label, settings and
 * summary, but its `exchange` refuses with `not_scripted`: a test can never
 * reach a real vendor by forgetting to script one.
 *
 * Script shape:
 *   { "providers": {
 *       "github":    { "outcome": "ok", "displayName": "GitHub — northwind", "credentials": { … } },
 *       "atlassian": { "outcome": "refuse", "reason": "access_denied" } } }
 */

import type { ConnectProvider } from './provider';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { z } from 'zod';

const OkSchema = z.object({
  outcome: z.literal('ok'),
  displayName: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()),
});
const RefuseSchema = z.object({
  outcome: z.literal('refuse'),
  reason: z.string().min(1),
});
/**
 * What verifying a connector answers, by connector slug ("Connect your
 * systems", `services/connect/verifyConnection.ts`): the test call's outcome
 * and the first sync's count, so the walk-through's "Found 1,284 deals" is
 * proved end to end without a vendor.
 */
const VerifySchema = z.union([
  z.object({ ok: z.literal(true), count: z.number().int().min(0), checks: z.array(z.string()).default([]) }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }),
]);
const ConnectScriptSchema = z.object({
  providers: z.record(z.string(), z.discriminatedUnion('outcome', [OkSchema, RefuseSchema])),
  verify: z.record(z.string(), VerifySchema).default({}),
});
export type ScriptedVerification = z.infer<typeof VerifySchema>;
type ConnectScript = z.infer<typeof ConnectScriptSchema>;

let cachedScript: { file: string; script: ConnectScript } | null = null;

/**
 * Whether the environment asks for scripted providers.
 */
export function connectScriptEnabled(): boolean {
  return Boolean(process.env.VOCION_CONNECT_SCRIPT);
}

/**
 * Read and validate the script file, once per process.
 * @param file - Path from `VOCION_CONNECT_SCRIPT`.
 */
function loadConnectScript(file: string): ConnectScript {
  if (cachedScript?.file === file) {
    return cachedScript.script;
  }
  const script = ConnectScriptSchema.parse(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  cachedScript = { file, script };
  return script;
}

/**
 * One real provider, with the script's part played in its exchange.
 * @param real - The real provider, kept for its id, label, connectors and summary.
 * @param script - The loaded script.
 */
function scriptedProvider(real: ConnectProvider, script: ConnectScript): ConnectProvider {
  const part = script.providers[real.id];
  if (!part) {
    return { ...real, exchange: async () => ({ ok: false, reason: 'not_scripted' }) };
  }
  return {
    ...real,
    configured: () => true,
    authorizeUrl: ({ state, redirectUri }) => `${redirectUri}?state=${encodeURIComponent(state)}&code=scripted`,
    exchange: async () => (part.outcome === 'ok'
      ? { ok: true, credentials: { ...part.credentials }, displayName: part.displayName }
      : { ok: false, reason: part.reason }),
  };
}

/**
 * The scripted verification for one connector, or null when the script names
 * none (or no script is running): the real verification runs then.
 * @param connector - Connector slug.
 */
export function scriptedVerification(connector: string): ScriptedVerification | null {
  const file = process.env.VOCION_CONNECT_SCRIPT;
  if (!file) {
    return null;
  }
  if (process.env.NODE_ENV === 'production' && process.env.VOCION_ALLOW_SCRIPTED_CONNECT !== '1') {
    return null;
  }
  return loadConnectScript(file).verify[connector] ?? null;
}

/**
 * The scripted stand-ins for these providers. Throws in production without
 * the allow flag, and when the script is unreadable: a silent fallback here
 * would let a test reach a real vendor.
 * @param providers - The real providers.
 */
export function scriptedProviders(providers: readonly ConnectProvider[]): ConnectProvider[] {
  if (process.env.NODE_ENV === 'production' && process.env.VOCION_ALLOW_SCRIPTED_CONNECT !== '1') {
    throw new Error('VOCION_CONNECT_SCRIPT is refused in production unless VOCION_ALLOW_SCRIPTED_CONNECT=1');
  }
  const file = process.env.VOCION_CONNECT_SCRIPT;
  if (!file) {
    throw new Error('Scripted connect needs VOCION_CONNECT_SCRIPT=<path to a script JSON>');
  }
  const script = loadConnectScript(file);
  return providers.map(provider => scriptedProvider(provider, script));
}
