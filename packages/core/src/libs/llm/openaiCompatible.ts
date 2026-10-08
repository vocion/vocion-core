/**
 * The four model providers core reaches through OpenAI's wire format: Azure OpenAI, Mistral,
 * Google Vertex AI (Gemini, through Vertex's OpenAI-compatible endpoint) and a self-hosted
 * OpenAI-compatible server (vLLM, Ollama, LM Studio). One shape: a base URL, a bearer key, and
 * the handful of ways each server departs from api.openai.com. The LangChain factory
 * (`./langchain.ts`) and the provider-neutral client (`./registry.ts`) both build on it, so a
 * provider added here works for agents, skills and the eval judge at once.
 *
 * WHICH KEY A CALL SPENDS. The workspace's stored credential first (its platform in
 * `libs/platforms/registry.ts`), the server's env second — the house rule:
 *
 * | provider            | stored platform       | env fallback                                                   |
 * |---------------------|-----------------------|----------------------------------------------------------------|
 * | `azure-openai`      | endpoint + key        | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`                |
 * | `mistral`           | key                   | `MISTRAL_API_KEY`                                              |
 * | `vertex`            | SA JSON (+ project)   | `VERTEX_CREDENTIALS`, `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`   |
 * | `openai-compatible` | base URL (+ key)      | `VOCION_OPENAI_COMPATIBLE_BASE_URL`, `…_API_KEY`               |
 *
 * Nothing here is cached by org: a connection is built per call. The one cache is Vertex's
 * minted access token, keyed on a digest of the exact service-account key it was minted from.
 */

import type { OpenAICompatibleProvider } from './providers';
import { Buffer } from 'node:buffer';
import { createHash, createSign } from 'node:crypto';
import process from 'node:process';
import { OPENAI_COMPATIBLE_PROVIDERS } from './providers';

export { OPENAI_COMPATIBLE_PROVIDERS };
export type { OpenAICompatibleProvider };

/**
 * Whether a provider is reached through this module.
 * @param provider - Any provider name.
 */
export function isOpenAICompatibleProvider(provider: string): provider is OpenAICompatibleProvider {
  return (OPENAI_COMPATIBLE_PROVIDERS as readonly string[]).includes(provider);
}

/** Where to send a chat completion, and how. */
export type OpenAIConnection = {
  provider: OpenAICompatibleProvider;
  baseURL: string;
  apiKey: string;
  defaultHeaders?: Record<string, string>;
  /**
   * Whether to ask for usage on a stream (`stream_options.include_usage`). Azure and Vertex take
   * it; Mistral and the self-hosted servers are not all known to, and an unknown option is a 422
   * on some of them, so they are not asked (Mistral reports usage on the last chunk regardless).
   */
  streamUsage: boolean;
  /** Where the connection came from, for an error message and a test. */
  from: 'org' | 'environment';
};

/** What a provider's credential holds, as stored or as read from the env. */
type Values = Record<string, string | undefined>;

const MISTRAL_BASE = 'https://api.mistral.ai/v1';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * The env half of each provider's credential.
 * @param provider - The provider.
 */
function envValues(provider: OpenAICompatibleProvider): Values {
  switch (provider) {
    case 'azure-openai':
      return { endpoint: process.env.AZURE_OPENAI_ENDPOINT, apiKey: process.env.AZURE_OPENAI_API_KEY };
    case 'mistral':
      return { apiKey: process.env.MISTRAL_API_KEY };
    case 'vertex':
      return { apiKey: process.env.VERTEX_CREDENTIALS, projectId: process.env.VERTEX_PROJECT_ID, location: process.env.VERTEX_LOCATION };
    case 'openai-compatible':
      return { baseUrl: process.env.VOCION_OPENAI_COMPATIBLE_BASE_URL, apiKey: process.env.VOCION_OPENAI_COMPATIBLE_API_KEY };
  }
}

/**
 * The env vars a provider reads, for the message that says none were set.
 * @param provider - The provider.
 */
export function envVarsFor(provider: OpenAICompatibleProvider): string {
  switch (provider) {
    case 'azure-openai':
      return 'AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY';
    case 'mistral':
      return 'MISTRAL_API_KEY';
    case 'vertex':
      return 'VERTEX_CREDENTIALS (and VERTEX_PROJECT_ID unless the key names its project)';
    case 'openai-compatible':
      return 'VOCION_OPENAI_COMPATIBLE_BASE_URL';
  }
}

function trimmed(v: string | undefined): string {
  return (v ?? '').trim();
}

/** A Google service-account key, read from its JSON. */
type ServiceAccount = { clientEmail: string; privateKey: string; projectId: string | null };

/**
 * The service account in a pasted JSON key, or null when the credential is not one (an access token).
 * @param credential - What was pasted.
 */
export function parseServiceAccount(credential: string): ServiceAccount | null {
  if (!credential.trim().startsWith('{')) {
    return null;
  }
  let json: { client_email?: string; private_key?: string; project_id?: string };
  try {
    json = JSON.parse(credential) as typeof json;
  } catch {
    throw new Error('The Vertex credential looks like JSON but does not parse. Paste the whole service-account key file.');
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('The Vertex credential is JSON but not a service-account key: it has no client_email or private_key.');
  }
  return { clientEmail: json.client_email, privateKey: json.private_key, projectId: json.project_id ?? null };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Drop every cached Vertex token. Test seam. */
export function resetVertexTokenCache(): void {
  tokenCache.clear();
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * An access token for a service account, minted (a signed JWT bearer assertion) or reused.
 * @param sa - The service account.
 * @param fetchImpl - Injectable for tests.
 * @param now - The clock.
 */
export async function vertexAccessToken(sa: ServiceAccount, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<string> {
  const digest = createHash('sha256').update(sa.clientEmail).update('\0').update(sa.privateKey).digest('hex');
  const cached = tokenCache.get(digest);
  if (cached && cached.expiresAt > now.getTime() + 5 * 60_000) {
    return cached.token;
  }
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iss: sa.clientEmail, scope: VERTEX_SCOPE, aud: TOKEN_ENDPOINT, iat, exp: iat + 3600 }))}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(sa.privateKey);
  } catch {
    throw new Error('The Vertex service-account private key could not sign a request. Paste the key file again.');
  }
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }).toString(),
  });
  if (!res.ok) {
    throw new Error(res.status === 400
      ? 'Google rejected the Vertex service account. Check the key is still active and its project has the Vertex AI API on.'
      : `Google would not issue a Vertex token (HTTP ${res.status}).`);
  }
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Google returned no access token for the Vertex service account.');
  }
  tokenCache.set(digest, { token: data.access_token, expiresAt: now.getTime() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

/**
 * The Vertex OpenAI-compatible base URL for a project and region.
 * @param projectId - The Google Cloud project.
 * @param location - The region, or `global`.
 */
export function vertexBaseUrl(projectId: string, location: string): string {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/endpoints/openapi`;
}

/**
 * A connection from one credential (stored or env), or null when it holds too little to call.
 * Async because a Vertex service account is exchanged for an access token.
 * @param provider - The provider.
 * @param values - The credential's fields.
 * @param from - Where they came from.
 * @param fetchImpl - Injectable for tests.
 */
export async function connectionFrom(provider: OpenAICompatibleProvider, values: Values, from: OpenAIConnection['from'], fetchImpl: typeof fetch = fetch): Promise<OpenAIConnection | null> {
  const apiKey = trimmed(values.apiKey);
  switch (provider) {
    case 'azure-openai': {
      const endpoint = trimmed(values.endpoint).replace(/\/+$/, '').replace(/\/openai(?:\/v1)?$/, '');
      if (!endpoint || !apiKey) {
        return null;
      }
      return { provider, baseURL: `${endpoint}/openai/v1/`, apiKey, defaultHeaders: { 'api-key': apiKey }, streamUsage: true, from };
    }
    case 'mistral':
      return apiKey ? { provider, baseURL: MISTRAL_BASE, apiKey, streamUsage: false, from } : null;
    case 'openai-compatible': {
      const baseURL = trimmed(values.baseUrl).replace(/\/+$/, '');
      // A local server that asks for no key still needs a non-empty bearer for the SDK.
      return baseURL ? { provider, baseURL, apiKey: apiKey || 'not-needed', streamUsage: false, from } : null;
    }
    case 'vertex': {
      if (!apiKey) {
        return null;
      }
      const sa = parseServiceAccount(apiKey);
      const projectId = trimmed(values.projectId) || sa?.projectId || trimmed(process.env.VERTEX_PROJECT_ID);
      if (!projectId) {
        throw new Error('Vertex needs a project: add the Project ID to the Vertex credential, or paste a service-account key that names one.');
      }
      const location = trimmed(values.location) || trimmed(process.env.VERTEX_LOCATION) || 'us-central1';
      const token = sa ? await vertexAccessToken(sa, fetchImpl) : apiKey;
      return { provider, baseURL: vertexBaseUrl(projectId, location), apiKey: token, streamUsage: true, from };
    }
  }
}

/**
 * The connection for an org: its stored credential first, the server's env second.
 * @param provider - The provider.
 * @param orgId - The workspace.
 * @param fetchImpl - Injectable for tests.
 * @throws {Error} When neither holds a usable credential, naming the env vars.
 */
export async function resolveOpenAIConnection(provider: OpenAICompatibleProvider, orgId: string | null, fetchImpl: typeof fetch = fetch): Promise<OpenAIConnection> {
  if (orgId) {
    const { resolveOrgProviderCredential } = await import('./orgKey');
    const stored = await resolveOrgProviderCredential(provider, orgId);
    const fromOrg = stored ? await connectionFrom(provider, stored, 'org', fetchImpl) : null;
    if (fromOrg) {
      return fromOrg;
    }
  }
  const fromEnv = await connectionFrom(provider, envValues(provider), 'environment', fetchImpl);
  if (!fromEnv) {
    throw new Error(`No ${provider} credential: store one for this workspace under API credentials, or set ${envVarsFor(provider)}; cannot construct ${provider} provider`);
  }
  return fromEnv;
}

/**
 * The env connection, synchronously, for the one caller that cannot wait (`buildChatModel`
 * with no org). A Vertex service account needs a token exchange, so it is refused here with
 * the way round it.
 * @param provider - The provider.
 */
export function envConnectionSync(provider: OpenAICompatibleProvider): OpenAIConnection {
  const values = envValues(provider);
  if (provider === 'vertex') {
    const credential = trimmed(values.apiKey);
    const projectId = trimmed(values.projectId);
    if (!credential || credential.startsWith('{') || !projectId) {
      throw new Error('A Vertex model built without an org needs VERTEX_CREDENTIALS as an access token and VERTEX_PROJECT_ID; with a service-account key, build it with buildChatModelForOrg.');
    }
    return { provider, baseURL: vertexBaseUrl(projectId, trimmed(values.location) || 'us-central1'), apiKey: credential, streamUsage: true, from: 'environment' };
  }
  const apiKey = trimmed(values.apiKey);
  if (provider === 'azure-openai') {
    const endpoint = trimmed(values.endpoint).replace(/\/+$/, '');
    if (endpoint && apiKey) {
      return { provider, baseURL: `${endpoint}/openai/v1/`, apiKey, defaultHeaders: { 'api-key': apiKey }, streamUsage: true, from: 'environment' };
    }
  } else if (provider === 'mistral') {
    if (apiKey) {
      return { provider, baseURL: MISTRAL_BASE, apiKey, streamUsage: false, from: 'environment' };
    }
  } else {
    const baseURL = trimmed(values.baseUrl).replace(/\/+$/, '');
    if (baseURL) {
      return { provider, baseURL, apiKey: apiKey || 'not-needed', streamUsage: false, from: 'environment' };
    }
  }
  throw new Error(`${envVarsFor(provider)} not set; cannot construct ${provider} provider`);
}
