/**
 * Credential platform registry — the list of platforms an org can hold a
 * credential for, and the rules for each one.
 *
 * Two very different things live in the same `api_token` table, and this
 * registry is what tells them apart:
 *
 *   - **Minted** (`vocion`). Vocion generates the secret, stores only its
 *     SHA-256, and shows the plaintext once. This is the credential an outside
 *     caller presents *to* Vocion.
 *   - **Supplied** (`openai`, `anthropic`, …). The person pastes the platform's
 *     own key. Vocion encrypts it at rest and later decrypts it to call *out*
 *     to that platform on the org's behalf, so the org's own account is billed.
 *
 * A second axis crosses that one — how many credentials an org may hold for a
 * platform, and therefore how a caller finds the right one:
 *
 *   - **One live** (`openai`, `anthropic`, `aws`, …). At most one live
 *     credential per org, so a caller asks for "the org's Anthropic key" and
 *     gets a single deterministic row. Saving a second key replaces the first.
 *   - **Many** (`vocion`, and the connector platforms `jira`, `strapi`,
 *     `hubspot`, `granola`). As many live credentials as the workspace wants,
 *     told apart by `name`. A caller names the one it wants by row id, which is
 *     what lets one Strapi install sync against staging while another uses
 *     production.
 *
 * Adding a platform means adding a descriptor here. Nothing else in the
 * service, router or UI enumerates platforms — with one deliberate exception:
 * `api_token_org_platform_live_idx` has to spell the `many` platform ids out in
 * SQL, because a partial index cannot call into TypeScript. {@link
 * MANY_CREDENTIAL_PLATFORM_IDS} is the list to keep it in step with, and
 * `registry.test.ts` fails if the two drift.
 */

import type { LLMProviderName } from '@vocion/sdk';

/** Every platform id this build understands. */
export type CredentialPlatformId
  = | 'vocion'
    | 'openai'
    | 'anthropic'
    | 'vertex'
    | 'azure-openai'
    | 'aws'
    | 'custom'
  // Connector platforms. One per API-key connector, so a workspace types its
  // Jira or Strapi key once and every connector install can point at it.
    | 'granola'
    | 'hubspot'
    | 'jira'
    | 'strapi';

/**
 * Where a platform's secret comes from.
 *
 * `minted` — Vocion generates it. `supplied` — the person pastes the
 * platform's own key.
 */
export type KeySource = 'minted' | 'supplied';

/**
 * How many credentials an org may hold for a platform, and therefore how a
 * caller finds the right one.
 *
 * `one-live` — at most one live credential. A caller asks for "the org's
 * Anthropic key" and gets a single deterministic row, so `name` is only a
 * label. Saving a second key replaces the first. Every LLM platform, plus
 * `aws` and `custom`.
 *
 * `many` — as many live credentials as the workspace wants, told apart by
 * `name`. A caller names the one it wants by row id, which is what lets one
 * install sync against "Strapi — staging" while another uses
 * "Strapi — prod". Every connector platform.
 */
export type CredentialsPerOrg = 'one-live' | 'many';

/**
 * One input a platform's credential is made of.
 *
 * Most platforms need a single secret string. AWS needs a pair — an access key
 * id, which is an identifier rather than a secret, and a secret access key
 * which very much is. Modelling fields explicitly is what lets the form and the
 * masking do the right thing for both.
 */
export type CredentialField = {
  /** Key this value is stored under inside the encrypted document. */
  name: string;
  /** Label on the form field. */
  label: string;
  /** Shape this value must match, or null to accept any non-empty string. */
  pattern: RegExp | null;
  /** Plain-language description of the expected shape, used in error text. */
  shapeHint: string;
  /**
   * Whether this value is secret. A non-secret field (an AWS access key id) is
   * shown back in full; a secret one is never readable again after saving.
   */
  secret: boolean;
};

export type CredentialPlatform = {
  id: CredentialPlatformId;
  /** Name shown in the platform selector. */
  label: string;
  keySource: KeySource;
  /**
   * Whether the org may hold one live credential here or many. See
   * {@link CredentialsPerOrg}. The database mirrors this in
   * `api_token_org_platform_live_idx`, which only constrains `one-live`
   * platforms.
   */
  credentialsPerOrg: CredentialsPerOrg;
  /**
   * The source connector whose installs authenticate with this platform's
   * credential, or `null` when no connector does. This is the bridge from
   * "the Jira connector needs a key" back to "look at the org's `jira`
   * credentials".
   */
  connectorSlug: string | null;
  /**
   * The LLM provider this platform's key authenticates, or `null` when the
   * platform is not an LLM provider at all (`vocion`, `custom`). Outbound
   * model calls resolve their key by looking up the platform whose
   * `llmProvider` matches the provider they are about to use.
   */
  llmProvider: LLMProviderName | null;
  /**
   * Shape a pasted key must match. `null` means any non-empty string is
   * accepted — the right answer for `custom`, and for platforms whose
   * credential format we do not want to guess at.
   */
  keyPattern: RegExp | null;
  /** Plain-language description of the expected shape, used in error text. */
  keyShapeHint: string;
  /** One line of guidance shown under the paste field. */
  helpText: string;
  /**
   * The inputs this credential is made of, in form order. Single-secret
   * platforms have exactly one; AWS has two.
   */
  fields: readonly CredentialField[];
};

/**
 * The single-secret field shape almost every platform uses.
 * @param label
 * @param pattern
 * @param shapeHint
 */
function singleKeyField(label: string, pattern: RegExp | null, shapeHint: string): readonly CredentialField[] {
  return [{ name: 'apiKey', label, pattern, shapeHint, secret: true }];
}

/**
 * The platform table. `vocion` is first because it is the default selection
 * and the only minted entry.
 */
const PLATFORMS: readonly CredentialPlatform[] = [
  {
    id: 'vocion',
    label: 'Vocion',
    keySource: 'minted',
    credentialsPerOrg: 'many',
    connectorSlug: null,
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'generated by Vocion',
    helpText: 'A token an outside tool presents to the Vocion API. You can show and copy it again at any time.',
    fields: [],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    llmProvider: 'openai',
    // OpenAI keys begin `sk-` and carry a long opaque tail. Project and
    // service-account keys (`sk-proj-…`, `sk-svcacct-…`) match the same shape.
    keyPattern: /^sk-[\w-]{16,}$/i,
    keyShapeHint: 'starts with "sk-" followed by at least 16 more characters',
    helpText: 'Your OpenAI secret key. Model calls for this workspace bill your OpenAI account.',
    fields: singleKeyField('OpenAI key', /^sk-[\w-]{16,}$/i, 'starts with "sk-" followed by at least 16 more characters'),
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    llmProvider: 'anthropic',
    keyPattern: /^sk-ant-[\w-]{16,}$/i,
    keyShapeHint: 'starts with "sk-ant-" followed by at least 16 more characters',
    helpText: 'Your Anthropic API key. Model calls for this workspace bill your Anthropic account.',
    fields: singleKeyField('Anthropic key', /^sk-ant-[\w-]{16,}$/i, 'starts with "sk-ant-" followed by at least 16 more characters'),
  },
  {
    id: 'vertex',
    label: 'Google Vertex AI',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    // A Vertex credential is a service-account JSON document or a short-lived
    // access token depending on how the customer authenticates, so there is no
    // single shape worth enforcing.
    llmProvider: 'vertex',
    keyPattern: null,
    keyShapeHint: 'any non-empty credential',
    helpText: 'A Vertex AI access token or the contents of a service-account JSON key.',
    fields: singleKeyField('Vertex credential', null, 'any non-empty credential'),
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    llmProvider: 'azure-openai',
    // Azure resource keys are 32+ hex-ish characters with no prefix.
    keyPattern: /^[A-Z0-9]{32,}$/i,
    keyShapeHint: 'at least 32 letters and digits, with no prefix',
    helpText: 'The key from your Azure OpenAI resource, under Keys and Endpoint.',
    fields: singleKeyField('Azure OpenAI key', /^[A-Z0-9]{32,}$/i, 'at least 32 letters and digits, with no prefix'),
  },
  {
    id: 'aws',
    label: 'AWS',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    // Null for now, not forever: Bedrock is reached through the AWS SDK rather
    // than the `LLMProviderName` adapters, so there is no provider to map to
    // until a `bedrock` adapter exists. Storing the pair today is what lets
    // that ticket be a routing change rather than a routing change plus a new
    // credential surface. Until then nothing in the model path reads it. See
    // `resolveAwsCredentials` for why AWS also skips the automatic env
    // fallback the model providers get.
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'an access key id (starting AKIA or ASIA) plus its secret access key',
    helpText: 'An IAM access key pair for AWS services like Bedrock. Scope it to only what you want Vocion to reach. Stored now; model calls through Bedrock arrive in a later release.',
    fields: [
      {
        name: 'accessKeyId',
        label: 'Access key ID',
        // AKIA = long-lived IAM user key, ASIA = temporary STS key.
        pattern: /^(?:AKIA|ASIA)[A-Z0-9]{12,}$/,
        shapeHint: 'starts with AKIA or ASIA followed by at least 12 more characters',
        // An access key id is an identifier, not a secret — AWS puts it in
        // request headers in the clear. Marking it non-secret is what keeps
        // the form field readable while it is typed, and what steers the
        // stored-key hint onto the secret access key instead of this.
        //
        // It is not read back to the list view today, and does not need to be:
        // one live credential per platform per org means there is never a
        // second AWS row to tell this one apart from. That changes with
        // VEERIO-248, where connector platforms may hold several credentials
        // at once and the non-secret fields become the way to identify them.
        secret: false,
      },
      {
        name: 'secretAccessKey',
        label: 'Secret access key',
        pattern: /^[A-Z0-9/+=]{40,}$/i,
        shapeHint: 'is at least 40 characters',
        secret: true,
      },
    ],
  },
  /* ---------------------------------------------------------------- */
  /* Connector platforms — a workspace may hold several of each.        */
  /* ---------------------------------------------------------------- */
  {
    id: 'granola',
    label: 'Granola',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlug: 'granola',
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'any non-empty API key',
    helpText: 'A Granola API key. The Granola connector reads meeting notes with it.',
    // Named `token` because that is the key the connector reads out of
    // `ctx.credentials`. The field name is the storage contract between the two.
    fields: [{ name: 'token', label: 'API key', pattern: null, shapeHint: 'is any non-empty API key', secret: true }],
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlug: 'hubspot',
    llmProvider: null,
    // Private-app tokens are `pat-<region>-<uuid>` today, but older keys and
    // OAuth access tokens reach this field too, so no shape is enforced.
    keyPattern: null,
    keyShapeHint: 'any non-empty token',
    helpText: 'A HubSpot private-app token, from Settings → Integrations → Private Apps. Needs CRM object read access.',
    // Named `token` to match what the connector reads out of `ctx.credentials`.
    fields: [{ name: 'token', label: 'Private-app token', pattern: null, shapeHint: 'is any non-empty token', secret: true }],
  },
  {
    id: 'jira',
    label: 'Jira',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlug: 'jira',
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'an Atlassian account email plus its API token',
    helpText: 'An Atlassian API token, from id.atlassian.com → Security → API tokens. Jira authenticates the token together with the email it was issued to.',
    fields: [
      {
        name: 'email',
        label: 'Atlassian account email',
        pattern: /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/,
        shapeHint: 'is an email address',
        // Half of Jira's basic-auth pair and not a secret — Atlassian puts it
        // in the request in the clear. Non-secret so the form keeps it
        // readable and the stored-key hint lands on the token instead.
        secret: false,
      },
      {
        name: 'apiToken',
        label: 'API token',
        pattern: null,
        shapeHint: 'is any non-empty token',
        secret: true,
      },
    ],
  },
  {
    id: 'strapi',
    label: 'Strapi',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlug: 'strapi',
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'an instance URL plus its API token',
    helpText: 'A Strapi API token, from Settings → API Tokens. Read-only is enough. A token only works against the instance that issued it, so the instance URL is kept with it.',
    fields: [
      {
        name: 'baseUrl',
        label: 'Instance URL',
        pattern: /^https?:\/\/\S+$/i,
        shapeHint: 'starts with http:// or https://',
        // Part of the credential rather than connector configuration: the
        // token is worthless against any other instance, so the two rotate
        // together. Non-secret, so the form and the credential list can show
        // it in full — which is also how one Strapi credential is told apart
        // from another.
        secret: false,
      },
      {
        name: 'token',
        label: 'API token',
        pattern: null,
        shapeHint: 'is any non-empty token',
        secret: true,
      },
    ],
  },
  {
    id: 'custom',
    label: 'Other platform',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlug: null,
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'any non-empty credential',
    helpText: 'Any other credential you want this workspace to keep. Stored encrypted; nothing calls it automatically.',
    fields: singleKeyField('Credential', null, 'any non-empty credential'),
  },
];

/**
 * A credential the person supplied is not acceptable, with a message written
 * for them.
 *
 * The distinct type is what lets the router tell "you pasted the wrong thing"
 * apart from "our database or vault failed". Only messages of this type are
 * safe to hand back to a client: every one of them is authored here, names no
 * secret, and describes something the person can fix. Anything else carries
 * whatever text the failing layer produced — a constraint detail, a connection
 * string, a KMS error — and gets replaced with a generic message instead.
 */
export class CredentialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialValidationError';
  }
}

/** How many trailing characters of a supplied key the UI is allowed to show. */
const KEY_HINT_CHARS = 4;

/** The platform every row falls back to — the historical behaviour of this table. */
export const DEFAULT_PLATFORM_ID: CredentialPlatformId = 'vocion';

/** Every platform, in the order the selector should list them. */
export function listPlatforms(): readonly CredentialPlatform[] {
  return PLATFORMS;
}

/**
 * Whether `value` names a platform this build knows.
 * @param value - Candidate platform id, typically off the wire.
 */
export function isCredentialPlatformId(value: unknown): value is CredentialPlatformId {
  return typeof value === 'string' && PLATFORMS.some(platform => platform.id === value);
}

/**
 * Look up a platform descriptor. Throws on an unknown id rather than returning
 * undefined: every caller here treats an unknown platform as a bug or a
 * tampered request, never as a case to handle.
 * @param id - The platform id to resolve.
 */
export function getPlatform(id: CredentialPlatformId): CredentialPlatform {
  const platform = PLATFORMS.find(candidate => candidate.id === id);
  if (!platform) {
    throw new Error(`unknown credential platform: ${id}`);
  }
  return platform;
}

/**
 * The platform whose stored key authenticates `provider`, or `null` when no
 * platform maps to it. This is the bridge from "the model call needs an
 * Anthropic key" back to "look for the org's `anthropic` row".
 * @param provider - The LLM provider about to be called.
 */
export function platformForLLMProvider(provider: LLMProviderName): CredentialPlatform | null {
  return PLATFORMS.find(platform => platform.llmProvider === provider) ?? null;
}

/**
 * Validate a pasted key against its platform and return it trimmed.
 *
 * Throws a message written for the person pasting the key. The message names
 * the expected shape but never echoes the value — an error string is one of
 * the easiest places for a secret to leak into a log.
 * @param id - The platform the key belongs to.
 * @param rawKey - The key exactly as the person supplied it.
 */
export function validatePlatformKey(id: CredentialPlatformId, rawKey: string): string {
  const platform = getPlatform(id);
  const [field] = platform.fields;
  if (platform.keySource === 'supplied' && platform.fields.length > 1) {
    throw new CredentialValidationError(`${platform.label} needs more than one value; use validatePlatformCredential.`);
  }
  const values = validatePlatformCredential(id, { [field?.name ?? 'apiKey']: rawKey });
  return values[field!.name]!;
}

/** A credential's values, keyed by field name. */
export type CredentialValues = Record<string, string>;

/**
 * Validate every field of a supplied credential and return the trimmed values.
 *
 * Throws a message written for the person filling the form. The message names
 * the field and the expected shape but never echoes a value — an error string
 * is one of the easiest places for a secret to leak into a log.
 * @param id - The platform the credential belongs to.
 * @param rawValues - Field values exactly as the person supplied them.
 */
export function validatePlatformCredential(
  id: CredentialPlatformId,
  rawValues: CredentialValues,
): CredentialValues {
  const platform = getPlatform(id);
  if (platform.keySource === 'minted') {
    throw new CredentialValidationError(`${platform.label} keys are generated by Vocion, not supplied.`);
  }
  const values: CredentialValues = {};
  for (const field of platform.fields) {
    const value = (rawValues[field.name] ?? '').trim();
    if (value.length === 0) {
      throw new CredentialValidationError(`Enter the ${field.label}.`);
    }
    if (field.pattern && !field.pattern.test(value)) {
      throw new CredentialValidationError(`That does not look like a valid ${field.label} — it ${field.shapeHint}.`);
    }
    values[field.name] = value;
  }
  return values;
}

/**
 * Every platform an org may hold more than one live credential for — the list
 * `api_token_org_platform_live_idx` carves out of its uniqueness rule.
 *
 * Derived from the descriptors rather than written out again, so a new
 * connector platform cannot be added without this list following. The
 * migration's SQL copy of the same list is checked against this one by
 * `registry.test.ts`.
 */
export const MANY_CREDENTIAL_PLATFORM_IDS: readonly CredentialPlatformId[]
  = PLATFORMS.filter(platform => platform.credentialsPerOrg === 'many').map(platform => platform.id);

/**
 * Whether an org may hold more than one live credential for `id`.
 * @param id - The platform to ask about.
 */
export function holdsManyCredentials(id: CredentialPlatformId): boolean {
  return getPlatform(id).credentialsPerOrg === 'many';
}

/**
 * The platform whose credentials authenticate the `slug` connector, or `null`
 * when that connector does not authenticate with a stored credential — every
 * OAuth connector, and every connector that needs no auth at all.
 * @param slug - A source connector slug, e.g. `strapi`.
 */
export function platformForConnectorSlug(slug: string): CredentialPlatform | null {
  return PLATFORMS.find(platform => platform.connectorSlug === slug) ?? null;
}

/**
 * The non-secret fields of a platform's credential, in form order. These are
 * the values safe to show in full — an instance URL, an account email — and so
 * the ones that tell two credentials for the same platform apart.
 * @param platform - The platform whose credential is being described.
 */
export function visibleFields(platform: CredentialPlatform): readonly CredentialField[] {
  return platform.fields.filter(field => !field.secret);
}

/**
 * The field whose value the list view should hint at — the last secret one, so
 * a pair like AWS hints at the secret access key rather than the access key id
 * that is already shown in full.
 * @param platform - The platform whose credential was stored.
 */
export function hintField(platform: CredentialPlatform): CredentialField | undefined {
  const secrets = platform.fields.filter(field => field.secret);
  return secrets[secrets.length - 1];
}

/**
 * The masked tail shown in the credential list, e.g. `…4a9F`. A key shorter
 * than the hint length is masked entirely rather than shown in full.
 * @param key - The plaintext key being stored.
 */
export function keyHint(key: string): string {
  if (key.length <= KEY_HINT_CHARS) {
    return '…';
  }
  return `…${key.slice(-KEY_HINT_CHARS)}`;
}
