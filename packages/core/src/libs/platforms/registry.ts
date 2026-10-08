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
import type { BrandKey } from '@/libs/brands/catalog';
import type { ConnectProviderId } from '@/libs/connect/provider';

/** Every platform id this build understands. */
export type CredentialPlatformId
  = | 'vocion'
    | 'openai'
    | 'anthropic'
    | 'vertex'
    | 'azure-openai'
    | 'aws'
    | 'custom'
  // A sign-in to an app the workspace builds, for its QA (several per org).
    | 'app-login'
  // Connector platforms. One per API-key connector, so a workspace types its
  // Jira or Strapi key once and every connector install can point at it.
    | 'apollo'
    | 'elevenlabs'
    | 'github'
    | 'granola'
    | 'hubspot'
    | 'jira'
    | 'notion'
    | 'posthog'
    | 'sentry'
    | 'slate'
    | 'strapi'
  // A business's numbers: the warehouse, product analytics and ad platform
  // families (`libs/connectors/families.ts`). One live credential each, so no
  // migration touches `api_token_org_platform_live_idx`; sources narrow by
  // their own settings (an allowlist of schemas, a project, an ad account).
    | 'snowflake'
    | 'bigquery'
    | 'databricks'
    | 'redshift'
    | 'mixpanel'
    | 'amplitude'
    | 'linkedin-ads'
    | 'meta-ads'
  // Any token-authenticated REST API the workspace declares endpoints for
  // (`libs/sources/rest.ts`). Several per org: one per API.
    | 'rest'
  // A QuickBooks Online login, one per company (`libs/sources/quickbooks.ts`).
    | 'quickbooks'
  // The finance family (`services/finance`): billing, books, spend and
  // payables. One account per workspace each (`one-live`, no migration).
    | 'stripe'
    | 'xero'
    | 'netsuite'
    | 'ramp'
    | 'bill'
  // The people family (`services/people`): the HR system of record.
    | 'gusto'
    | 'rippling'
    | 'workday'
  // One credential, several connectors. A Google OAuth client is consented
  // once and its refresh token then serves Gmail, Drive, Calendar, Analytics
  // and Ads together; a Slack bot token reads every channel the workspace
  // syncs; a Zoom server-to-server app covers the whole account.
    | 'google'
    | 'slack'
    | 'zoom'
  // Measurement platforms. Read-only, and resolved per org with no row id in
  // hand, because a `verified` measure names a connector rather than a
  // credential — see the descriptor for why that forces `one-live`.
    | 'google-analytics'
  // Tool platforms. One per paid built-in tool provider, so a workspace that
  // pastes its own Tavily or Firecrawl key spends its own account on tool
  // calls the way it already does on model calls.
    | 'tavily'
    | 'brave'
    | 'firecrawl'
  // Login apps (#1080). A workspace's own OAuth app at a vendor, so its "Log
  // in with <vendor>" runs on the workspace's client ID and secret instead of
  // the server's env. One live per vendor: saving a new one replaces the old.
    | 'slack-login-app'
    | 'atlassian-login-app'
    | 'google-login-app'
    | 'hubspot-login-app'
    | 'notion-login-app'
    | 'zoom-login-app'
    | 'apollo-login-app'
    | 'quickbooks-login-app'
    | 'xero-login-app'
    | 'gusto-login-app'
    | 'linkedin-login-app';

/**
 * A built-in tool provider whose calls are paid for with a platform key.
 *
 * Only the providers that bill someone appear here. `builtin` browse and the
 * calculator call nothing and need no key, so no platform claims them.
 */
export type CredentialToolProvider = 'tavily' | 'brave' | 'firecrawl' | 'openai';

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
  /**
   * Whether the credential is complete without this value. Google Ads needs a
   * developer token alongside the OAuth set that the other four Google
   * connectors do not, so the shared Google credential carries it as an extra
   * a workspace fills in only if it syncs Ads.
   */
  optional?: boolean;
};

/** How one connector logs in: see `CredentialPlatform['howToConnect']`. */
export type LoginDeclaration = {
  /** The connect provider that runs it (`libs/connect/registry.ts`). */
  provider: ConnectProviderId;
  /** The access the login asks for, one line each, in the vendor's words. */
  access: readonly string[];
  /**
   * The settings the source still needs after the login, by config key, each with the
   * name a person knows it by. Empty means login alone is enough and the login makes the
   * source itself. This is the one answer: the callback, the form, the chat card and the
   * agent's next step all read it.
   */
  settingsAfterLogin: readonly { key: string; label: string }[];
};

export type CredentialPlatform = {
  id: CredentialPlatformId;
  /** Name shown in the platform selector. */
  label: string;
  /**
   * The vendor's brand, a key in `libs/brands/catalog.ts`: what every surface
   * showing this platform (the credentials list, a model picker, the Tools
   * catalog) draws its tile with. Absent for a platform that is not one
   * vendor — Vocion's own token, a REST API, "Other platform".
   */
  brand?: BrandKey;
  keySource: KeySource;
  /**
   * Whether the org may hold one live credential here or many. See
   * {@link CredentialsPerOrg}. The database mirrors this in
   * `api_token_org_platform_live_idx`, which only constrains `one-live`
   * platforms.
   */
  credentialsPerOrg: CredentialsPerOrg;
  /**
   * The source connectors whose installs authenticate with this platform's
   * credential, empty when no connector does. This is the bridge from "the
   * Jira connector needs a key" back to "look at the org's `jira`
   * credentials".
   *
   * Usually one. Several when a single grant covers several connectors: one
   * Google OAuth consent yields a refresh token that Gmail, Drive, Calendar,
   * Analytics and Ads all authenticate with.
   */
  connectorSlugs: readonly string[];
  /**
   * Whether two sources may point at the same stored credential.
   *
   * False for a credential issued for one place — a Strapi token is worthless
   * against any instance but the one that minted it, so offering it to a
   * second install would only produce a failing sync. True for an
   * account-wide grant: one Slack bot token reads every channel, and a
   * workspace syncing five channels should type it once rather than five
   * times.
   */
  credentialsShareable: boolean;
  /**
   * The built-in tool provider this platform's key authenticates, or `null`
   * when the platform backs no tool. This is the bridge from "the web_search
   * tool is about to call Tavily" back to "look at the org's `tavily`
   * credential", and the tool counterpart of {@link CredentialPlatform.llmProvider}.
   */
  toolProvider: CredentialToolProvider | null;
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
  /**
   * Set on a login-app platform only: the connect provider whose logins run on
   * the OAuth app this credential holds. `libs/connect/loginClient.ts` reads
   * it to prefer the workspace's own app over the server's env.
   */
  loginAppFor?: ConnectProviderId;
  /**
   * How a person connects this platform (#1080). The Connectors form and the
   * chat card read this instead of special-casing providers. Declared on every
   * platform that backs a connector. It stays free of runtime imports so client
   * UI can read it; `howToConnect.test.ts` holds the login half to the connect
   * registry and the provider scope constants.
   */
  howToConnect?: {
    /** Present when a provider login can fetch the credential itself. */
    login?: LoginDeclaration;
    /**
     * For a platform whose connectors log in differently, each connector's own
     * login, in place of `login`. Google needs it: Gmail, Drive, Calendar and
     * Analytics each ask for their own scope, and Google Ads cannot log in at
     * all. A connector left out of it has no login. `howToConnectFor` folds
     * the connector's entry into `login`, so callers never read this.
     */
    loginByConnector?: Readonly<Record<string, LoginDeclaration>>;
    /**
     * What to paste, and where to get one by hand. Absent for a vendor that
     * issues no credential a person could paste and keep working (QuickBooks:
     * Intuit has no API keys, and rotates the refresh token a login holds), so
     * the form offers the login alone and never an input that cannot work.
     */
    paste?: {
      /** The kind of credential, named the way the vendor names it: "Personal access token", "API token", "Bot token". */
      credential: string;
      /** The access the pasted credential needs, one line each. */
      access: readonly string[];
      /** Where to make one by hand. Only a URL the vendor documents. Leave it out rather than guess. */
      getItAt?: { url: string; steps: readonly string[] };
    };
  };
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
 * A login-app platform: a workspace's own OAuth app at one vendor. A login
 * with that vendor runs on its client ID and secret instead of the server's
 * env, so a workspace can bring its own app without a redeploy. It is not a
 * connector credential: no source points at it, and the logins it runs are
 * stored on the connectors' own platforms as before.
 * @param id - The platform id, `<provider>-login-app`.
 * @param provider - The connect provider whose logins it runs.
 * @param vendor - The vendor's name, as the form shows it.
 * @param brand - The vendor's brand, for the tile.
 */
function loginAppPlatform(id: CredentialPlatformId, provider: ConnectProviderId, vendor: string, brand: BrandKey): CredentialPlatform {
  return {
    id,
    label: `${vendor} login app`,
    brand,
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a client ID and a client secret',
    helpText: `Your own ${vendor} OAuth app. Logins with ${vendor} in this workspace use it instead of the server's, so it works without a redeploy. Saving a new app replaces the old one, and logins made with the old app need logging in again.`,
    fields: [
      { name: 'clientId', label: 'Client ID', pattern: null, shapeHint: `the Client ID from your ${vendor} app's settings`, secret: false },
      { name: 'clientSecret', label: 'Client secret', pattern: null, shapeHint: `the Client secret from the same page`, secret: true },
    ],
    loginAppFor: provider,
  };
}

/**
 * The login apps a workspace can bring, one per connect provider whose login
 * is a plain client ID and secret. GitHub is left out because its login is a
 * GitHub App (an app id, a private key and a webhook the server receives), and
 * PostHog because its client is a public document this server publishes
 * (CIMD), with no secret to bring.
 */
const LOGIN_APP_PLATFORMS: readonly CredentialPlatform[] = [
  loginAppPlatform('google-login-app', 'google', 'Google', 'google'),
  loginAppPlatform('slack-login-app', 'slack', 'Slack', 'slack'),
  loginAppPlatform('atlassian-login-app', 'atlassian', 'Atlassian', 'atlassian'),
  loginAppPlatform('hubspot-login-app', 'hubspot', 'HubSpot', 'hubspot'),
  loginAppPlatform('notion-login-app', 'notion', 'Notion', 'notion'),
  loginAppPlatform('zoom-login-app', 'zoom', 'Zoom', 'zoom'),
  loginAppPlatform('apollo-login-app', 'apollo', 'Apollo', 'apolloio'),
  loginAppPlatform('quickbooks-login-app', 'quickbooks', 'QuickBooks', 'quickbooks'),
  loginAppPlatform('xero-login-app', 'xero', 'Xero', 'xero'),
  loginAppPlatform('gusto-login-app', 'gusto', 'Gusto', 'gusto'),
  loginAppPlatform('linkedin-login-app', 'linkedin', 'LinkedIn', 'linkedin'),
];

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
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'generated by Vocion',
    helpText: 'A token an outside tool presents to the Vocion API. You can show and copy it again at any time.',
    fields: [],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    brand: 'openai',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: 'openai',
    // Image generation bills the same OpenAI account, so the image tool
    // resolves its key through this platform rather than one of its own.
    toolProvider: 'openai',
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
    brand: 'anthropic',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: 'anthropic',
    toolProvider: null,
    keyPattern: /^sk-ant-[\w-]{16,}$/i,
    keyShapeHint: 'starts with "sk-ant-" followed by at least 16 more characters',
    helpText: 'Your Anthropic API key. Model calls for this workspace bill your Anthropic account.',
    fields: singleKeyField('Anthropic key', /^sk-ant-[\w-]{16,}$/i, 'starts with "sk-ant-" followed by at least 16 more characters'),
  },
  {
    id: 'vertex',
    label: 'Google Vertex AI',
    brand: 'googlecloud',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    // A Vertex credential is a service-account JSON document or a short-lived
    // access token depending on how the customer authenticates, so there is no
    // single shape worth enforcing.
    llmProvider: 'vertex',
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'any non-empty credential',
    helpText: 'A Vertex AI access token or the contents of a service-account JSON key.',
    fields: singleKeyField('Vertex credential', null, 'any non-empty credential'),
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    brand: 'microsoftazure',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: 'azure-openai',
    toolProvider: null,
    // Azure resource keys are 32+ hex-ish characters with no prefix.
    keyPattern: /^[A-Z0-9]{32,}$/i,
    keyShapeHint: 'at least 32 letters and digits, with no prefix',
    helpText: 'The key from your Azure OpenAI resource, under Keys and Endpoint.',
    fields: singleKeyField('Azure OpenAI key', /^[A-Z0-9]{32,}$/i, 'at least 32 letters and digits, with no prefix'),
  },
  {
    id: 'aws',
    label: 'AWS',
    brand: 'amazonwebservices',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    // Maps to `bedrock`, the Amazon Bedrock model provider. This is the one
    // platform whose credential is a pair rather than a single key, so it is
    // also the one platform `resolveOrgProviderKey` cannot serve — that helper
    // returns a single string and would hand back the access key id. Bedrock
    // call sites go through `resolveBedrockCredentials` in
    // `libs/llm/bedrockCredentials.ts` instead, which reads both fields. See
    // `resolveAwsCredentials` for why AWS also skips the automatic env
    // fallback the single-key model providers get.
    llmProvider: 'bedrock',
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an access key id (starting AKIA or ASIA) plus its secret access key',
    helpText: 'An IAM access key pair for AWS services like Bedrock. Scope it to only what you want Vocion to reach. Model calls routed to Bedrock spend this key, so the usage lands on your own AWS bill.',
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
        // LARK-248, where connector platforms may hold several credentials
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
    id: 'apollo',
    label: 'Apollo',
    brand: 'apolloio',
    keySource: 'supplied',
    // `one-live` rather than the `many` its sibling connectors get. Widening
    // the cap means rebuilding `api_token_org_platform_live_idx` to carve
    // apollo out of it, and a partial UNIQUE index has no concurrent route:
    // `check:migrations` refuses the plain build, and `concurrent/` refuses
    // UNIQUE because dev and the tests would then accept rows production
    // rejects. Nothing exercises it yet — no org holds an Apollo key at all,
    // and master-key detection reads whichever single key is stored — so the
    // cap waits for the first workspace that actually needs two.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['apollo'],
    howToConnect: {
      login: {
        provider: 'apollo',
        access: ['read_user_profile', 'app_scopes'],
        settingsAfterLogin: [],
      },
      paste: {
        credential: 'API key',
        access: [],
      },
    },
    credentialsShareable: false,
    toolProvider: null,
    llmProvider: null,
    // Apollo keys are opaque and their shape has changed over the years, so
    // nothing is enforced beyond non-empty. Test connection is what tells an
    // operator whether the key works, and what it opens.
    keyPattern: null,
    keyShapeHint: 'any non-empty API key',
    helpText: 'An Apollo API key, from Settings → Integrations → API. A master key additionally opens per-endpoint usage stats; Test connection reports which you pasted.',
    // Named `token` to match what the client reads out of the credential bag.
    fields: [{ name: 'token', label: 'API key', pattern: null, shapeHint: 'is any non-empty API key', secret: true }],
  },
  {
    id: 'github',
    label: 'GitHub',
    brand: 'github',
    keySource: 'supplied',
    // `one-live`, for the reason Apollo and Notion are: widening the cap means
    // rebuilding `api_token_org_platform_live_idx`, and nothing needs two yet.
    // One token reads every repository it was granted, and a source narrows by
    // its repository list, so several github sources share the one credential.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['github'],
    howToConnect: {
      login: { provider: 'github', access: ['The repositories you choose during install'], settingsAfterLogin: [{ key: 'repos', label: 'repositories' }] },
      paste: {
        credential: 'Personal access token',
        access: ['pull_requests:read', 'checks:read', 'contents:read', 'metadata:read', 'actions:read (for run.failed on the deploy branch)'],
        getItAt: { url: 'https://github.com/settings/personal-access-tokens/new', steps: ['Make a fine-grained personal access token', 'Grant it the repositories the source lists', 'Give it the read-only permissions listed above'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    // Fine-grained tokens are `github_pat_…`, classic ones `ghp_…`, and a
    // GitHub App installation token `ghs_…`; all three work here, so no shape
    // is enforced. Test connection is what says whether the token reads what
    // the source needs.
    keyPattern: null,
    keyShapeHint: 'any non-empty access token',
    helpText: 'A GitHub fine-grained personal access token (github.com/settings/personal-access-tokens) or a GitHub App installation token, granted on the repositories the source lists with read-only permissions: pull_requests:read, checks:read, contents:read, metadata:read — plus actions:read for run.failed on the deploy branch. It is used read-only; Vocion never writes to GitHub with it.',
    // Named `token` because that is the key the connector reads out of
    // `ctx.credentials`. The field name is the storage contract between the two.
    fields: [{ name: 'token', label: 'Access token', pattern: null, shapeHint: 'is any non-empty token', secret: true }],
  },
  {
    id: 'granola',
    label: 'Granola',
    brand: 'granola',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['granola'],
    howToConnect: {
      paste: {
        credential: 'API key',
        access: [],
      },
    },
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
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
    brand: 'hubspot',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['hubspot'],
    howToConnect: {
      login: {
        provider: 'hubspot',
        access: ['oauth', 'crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read'],
        settingsAfterLogin: [],
      },
      paste: {
        credential: 'Private-app token',
        access: ['CRM object read access'],
      },
    },
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
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
    brand: 'jira',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['jira'],
    howToConnect: {
      login: { provider: 'atlassian', access: ['read:jira-work', 'read:jira-user', 'offline_access'], settingsAfterLogin: [{ key: 'baseUrl', label: 'site' }, { key: 'projectKeys', label: 'project keys' }] },
      paste: {
        credential: 'API token',
        access: [],
        getItAt: { url: 'https://id.atlassian.com/manage-profile/security/api-tokens', steps: ['Make an API token', 'Paste it with the Atlassian account email it was issued to'] },
      },
    },
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
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
    id: 'notion',
    label: 'Notion',
    brand: 'notion',
    keySource: 'supplied',
    // `one-live`, like Apollo and unlike its sibling connector platforms.
    // Widening the cap means rebuilding `api_token_org_platform_live_idx` to
    // carve `notion` out of it, and a partial UNIQUE index has no concurrent
    // route: `check:migrations` refuses the plain build. One internal
    // integration token reaches everything shared with it, so a second one
    // buys a workspace nothing until it connects a second Notion workspace —
    // the cap waits for the workspace that actually needs two.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['notion'],
    howToConnect: {
      // Notion has no scopes: the person picks the pages on Notion's consent
      // screen, and the integration's registered capabilities say what it may do.
      login: {
        provider: 'notion',
        access: ['The pages and databases you pick on Notion\'s consent screen'],
        settingsAfterLogin: [],
      },
      paste: {
        credential: 'Internal integration token',
        access: ['Pages and databases shared with the integration, from the page\'s Connections menu'],
        getItAt: { url: 'https://notion.so/my-integrations', steps: ['Make an internal integration', 'Share the pages and databases it should see from the page\'s Connections menu'] },
      },
    },
    // One integration token reads every page shared with it, and a source
    // narrows by search term rather than by credential, so a workspace running
    // several Notion sources types the token once.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    // Internal integration tokens have been `secret_…` and are `ntn_…` since
    // 2024; OAuth access tokens reach this field too, so no shape is enforced.
    keyPattern: null,
    keyShapeHint: 'any non-empty integration token',
    helpText: 'A Notion internal integration token, from notion.so/my-integrations. The integration only sees pages and databases explicitly shared with it, from the page\'s Connections menu.',
    // Named `token` because that is the key the connector reads out of
    // `ctx.credentials`. The field name is the storage contract between the two.
    fields: [{ name: 'token', label: 'Integration token', pattern: null, shapeHint: 'is any non-empty token', secret: true }],
  },
  {
    id: 'posthog',
    label: 'PostHog',
    brand: 'posthog',
    keySource: 'supplied',
    // `one-live`, for the reason Apollo and Notion are: widening the cap means
    // rebuilding `api_token_org_platform_live_idx`, and nothing needs two yet.
    // A workspace reports one product line into one PostHog project, and a
    // second source over the same project (another product filter) shares the
    // credential rather than needing its own.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['posthog'],
    howToConnect: {
      // A login that covers one project stores its id; one that covers
      // several needs it picked, so the form always offers the field.
      login: {
        provider: 'posthog',
        access: ['query:read', 'event_definition:read', 'project:read'],
        settingsAfterLogin: [{ key: 'projectId', label: 'project id' }],
      },
      paste: {
        credential: 'Personal API key',
        access: ['query:read', 'event_definition:read'],
      },
    },
    // One personal key reads every project its owner can see, so several
    // posthog sources — one per product filter — type it once.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a PostHog host, the numeric project id, and a personal API key starting phx_',
    helpText: 'A PostHog personal API key, from Settings → Personal API keys. It is private to whoever created it and used read-only here: give it query:read and event_definition:read on this project, nothing more. The public project token (phc_…) that ships in your app is NOT what goes here — it can only send events. The host and project id are kept with the key because the key is only ever spent against them.',
    fields: [
      {
        name: 'host',
        label: 'PostHog host',
        pattern: /^https?:\/\/\S+$/i,
        shapeHint: 'starts with http:// or https:// — https://us.posthog.com, https://eu.posthog.com, or your own install',
        // Where the key is spent. Non-secret, shown in full, and what tells a
        // US project apart from an EU one in the credential list.
        secret: false,
      },
      {
        name: 'projectId',
        label: 'Project ID',
        pattern: /^\d+$/,
        shapeHint: 'is the numeric project id from Settings → Project (the number after /project/ in the URL), not the phc_ token',
        secret: false,
      },
      {
        name: 'apiKey',
        label: 'Personal API key',
        // Personal keys carry `phx_`; the public project token carries `phc_`,
        // and refusing it here is what turns "sync finds nothing" into a
        // sentence at paste time.
        pattern: /^phx_[\w-]{8,}$/i,
        shapeHint: 'starts with "phx_" — a personal API key. A phc_ token is the public project token and cannot read anything',
        secret: true,
      },
    ],
  },
  {
    id: 'sentry',
    label: 'Sentry',
    brand: 'sentry',
    keySource: 'supplied',
    // `one-live`, for the reason Apollo, Notion and PostHog are: widening the
    // cap means rebuilding `api_token_org_platform_live_idx`, and one token
    // reads every project of the organization it was made in.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['sentry'],
    howToConnect: {
      paste: {
        credential: 'Auth token',
        access: ['org:read', 'project:read', 'event:read'],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Sentry region host, the organization slug, and an auth token',
    helpText: 'A Sentry auth token (Settings → Auth Tokens, or an internal integration) with org:read, project:read and event:read — read-only: Vocion never resolves, assigns or comments on an issue. The organization slug is the part of your Sentry address before .sentry.io; the host is your data region (https://us.sentry.io, https://de.sentry.io) or your own install. A DSN is NOT what goes here: it can only send events.',
    fields: [
      {
        name: 'host',
        label: 'Sentry host',
        pattern: /^https?:\/\/[^\s/]+\/?$/i,
        shapeHint: 'is an address such as https://us.sentry.io, https://de.sentry.io, or your own install',
        // Where the token is spent; shown in full, and what tells a US
        // organization apart from an EU one in the credential list.
        secret: false,
      },
      {
        name: 'org',
        label: 'Organization slug',
        pattern: /^[\w-]+$/,
        shapeHint: 'is the organization slug: letters, digits and dashes, as in <slug>.sentry.io',
        secret: false,
      },
      {
        name: 'token',
        label: 'Auth token',
        // A DSN is a URL with a public key in it; refusing it here turns
        // "every read is unauthorized" into a sentence at paste time.
        pattern: /^(?!https?:\/\/)\S{16,}$/i,
        shapeHint: 'is an auth token (sntrys_… or sntryu_…), not a DSN — a DSN is an https:// address that can only send events',
        secret: true,
      },
    ],
  },
  {
    id: 'slate',
    label: 'Slate',
    brand: 'slate',
    keySource: 'supplied',
    // `one-live`, like Sentry and PostHog: one Slate account per workspace,
    // asked for with no row id in hand.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['slate'],
    howToConnect: {
      paste: {
        credential: 'Session token',
        access: [],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Slate session token (slt_…)',
    helpText: 'A Slate session token (slt_…, about 90 days) — sign in to Slate\'s desktop or command-line app and copy its token. Test connection reads whose account it is; nothing is synced or uploaded.',
    fields: [
      {
        name: 'token',
        label: 'Session token',
        pattern: /^slt_\S{8,}$/,
        shapeHint: 'is a Slate session token, starting slt_',
        secret: true,
      },
    ],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    brand: 'elevenlabs',
    keySource: 'supplied',
    // `one-live`, for the reason Apollo, Notion, PostHog and Sentry are:
    // widening the cap means rebuilding `api_token_org_platform_live_idx`, and
    // one key speaks in every voice of the account.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['elevenlabs'],
    howToConnect: {
      paste: {
        credential: 'API key',
        access: ['Text to Speech', 'Voices (read)', 'User (read) if Test connection should show the characters left'],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an ElevenLabs API key',
    helpText: 'An ElevenLabs API key, from Developers → API Keys. It needs Text to Speech and Voices (read); User (read) lets Test connection show the characters left. Speaking a line spends the account\'s characters, so the usage lands on your own ElevenLabs plan.',
    // `apiKey`: the key `libs/voice/elevenlabs.ts` reads out of the credential.
    fields: singleKeyField('API key', /^\S{16,}$/, 'is an API key with no spaces, at least 16 characters (sk_…)'),
  },
  {
    id: 'strapi',
    label: 'Strapi',
    brand: 'strapi',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['strapi'],
    howToConnect: {
      paste: {
        credential: 'API token',
        access: ['Read-only'],
      },
    },
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
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
    id: 'rest',
    label: 'REST API (bearer token)',
    keySource: 'supplied',
    // `many`, like `strapi`, and for the same reason: the credential is a token
    // plus the base URL it was issued for, so it names one API and a workspace
    // with two APIs needs two. Migration 0153 carved `rest` out of
    // `api_token_org_platform_live_idx` to allow it — before that, connecting a
    // second REST source silently revoked the first, because a one-live
    // platform reads a second save as a rotation. Each source names the
    // credential it uses through `knowledge_source.api_token_id`.
    //
    // The token is sent as `Authorization: Bearer <token>` on every call; there
    // is no other header scheme, on purpose — one shape, and the first API to
    // need another can add a `headerName` field beside these two.
    credentialsPerOrg: 'many',
    connectorSlugs: ['rest'],
    howToConnect: {
      paste: {
        credential: 'Bearer token',
        access: ['Read rights for the read tools', 'Write rights only for the endpoints the source declares as actions'],
      },
    },
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an API base URL plus its bearer token',
    helpText: 'A bearer token for a REST API of your own, and the base URL it was issued for. The token goes out as "Authorization: Bearer <token>" on every call: read rights for the read tools, write rights only for the endpoints the source declares as actions.',
    fields: [
      {
        name: 'baseUrl',
        label: 'API base URL',
        pattern: /^https?:\/\/\S+$/i,
        shapeHint: 'starts with http:// or https://',
        // Part of the credential, as with Strapi: a token is issued for one
        // API, so the two rotate together. Non-secret, so the credential
        // list can show which API a token is for.
        secret: false,
      },
      {
        name: 'token',
        label: 'Bearer token',
        pattern: null,
        shapeHint: 'is any non-empty token',
        secret: true,
      },
    ],
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    brand: 'quickbooks',
    keySource: 'supplied',
    // `one-live` for now: a login is one QuickBooks company, so a workspace
    // reads one company's books. A firm with several companies (one per legal
    // entity) needs `many`, which means carving `quickbooks` out of
    // `api_token_org_platform_live_idx` in a migration (PR #1224 carries it);
    // until then a second login replaces the first.
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['quickbooks'],
    howToConnect: {
      // Login only: Intuit issues no API key, and the refresh token a login
      // holds is rotated by Intuit, so a pasted one would stop working within
      // a day. A source can read the sample company with no login at all.
      login: { provider: 'quickbooks', access: ['com.intuit.quickbooks.accounting'], settingsAfterLogin: [] },
    },
    // One login reads one company, and a source reads all of it, so a second
    // source on the same company may share the login.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a QuickBooks login',
    helpText: 'A QuickBooks Online login, one per company. Log in with QuickBooks on the Connectors page; there is no key to paste.',
    fields: [],
  },
  /* ---------------------------------------------------------------- */
  /* The finance and people families. Each is `one-live` — one account   */
  /* per workspace — because widening the cap means a migration on       */
  /* `api_token_org_platform_live_idx`, and nothing needs two yet. One   */
  /* credential reads the whole account, so sources may share it.        */
  /* ---------------------------------------------------------------- */
  {
    id: 'stripe',
    label: 'Stripe',
    brand: 'stripe',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['stripe'],
    howToConnect: {
      paste: {
        credential: 'Restricted API key',
        access: ['Customers: Read', 'Invoices: Read', 'Subscriptions: Read', 'Payouts: Read', 'Charges and PaymentIntents: Read', 'Invoices: Write only if agents may draft invoices'],
        getItAt: { url: 'https://dashboard.stripe.com/apikeys', steps: ['Create restricted key', 'Give it Read on the resources listed above and nothing else', 'Copy the rk_live_… key'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: /^[rs]k_(?:live|test)_\w{10,}$/,
    keyShapeHint: 'a restricted key starting rk_live_ or rk_test_',
    helpText: 'A Stripe restricted key (Developers → API keys → Create restricted key) with Read on customers, invoices, subscriptions, payouts, charges and payment intents. Nothing it reads moves money. Add Invoices: Write only if agents may prepare draft invoices, which are never sent or charged. A publishable key (pk_…) cannot read anything.',
    fields: singleKeyField('Restricted API key', /^[rs]k_(?:live|test)_\w{10,}$/, 'starts with rk_live_ or rk_test_ (a restricted key; a secret key sk_… works but reads more than Vocion needs)'),
  },
  {
    id: 'xero',
    label: 'Xero',
    brand: 'xero',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['xero'],
    howToConnect: {
      login: {
        provider: 'xero',
        access: ['openid', 'profile', 'email', 'offline_access', 'accounting.transactions.read', 'accounting.contacts.read', 'accounting.reports.read', 'accounting.settings.read'],
        settingsAfterLogin: [],
      },
      paste: {
        credential: 'Custom connection client ID and secret',
        access: ['accounting.transactions.read', 'accounting.contacts.read', 'accounting.settings.read'],
        getItAt: { url: 'https://developer.xero.com/app/manage', steps: ['New app → Custom connection', 'Select the read scopes listed above', 'Have the organisation\'s admin authorise it', 'Copy the client ID and secret'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Xero custom connection\'s client ID and secret, or a Xero login',
    helpText: 'Log in with Xero and pick the organisation, or paste a Xero custom connection (developer.xero.com → New app → Custom connection) with read-only accounting scopes. Either reads one organisation, read-only.',
    fields: [
      { name: 'clientId', label: 'Client ID', pattern: /^\w{16,}$/, shapeHint: 'is the custom connection\'s client ID (32 letters and digits)', secret: false },
      { name: 'clientSecret', label: 'Client secret', pattern: /^\S{16,}$/, shapeHint: 'is the custom connection\'s client secret', secret: true },
    ],
  },
  {
    id: 'netsuite',
    label: 'NetSuite',
    brand: 'netsuite',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['netsuite'],
    howToConnect: {
      paste: {
        credential: 'Token-based authentication (integration + access token)',
        access: ['REST Web Services', 'SuiteAnalytics Workbook', 'View on Customers, Vendors, Transactions and Accounts', 'Log in using Access Tokens'],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an account ID, an integration\'s consumer key and secret, and an access token\'s ID and secret',
    helpText: 'NetSuite token-based authentication: an integration record (Setup → Integration → Manage Integrations, Token-Based Authentication on) gives the consumer key and secret; an access token for a role with read-only permissions gives the token ID and secret. The account ID is on Setup → Company → Company Information (e.g. 1234567 or 1234567_SB1 for a sandbox).',
    fields: [
      { name: 'accountId', label: 'Account ID', pattern: /^[\w-]{3,}$/, shapeHint: 'is the account ID, e.g. 1234567 or 1234567_SB1', secret: false },
      { name: 'consumerKey', label: 'Consumer key', pattern: /^\S{16,}$/, shapeHint: 'is the integration record\'s consumer key', secret: true },
      { name: 'consumerSecret', label: 'Consumer secret', pattern: /^\S{16,}$/, shapeHint: 'is the integration record\'s consumer secret', secret: true },
      { name: 'tokenId', label: 'Token ID', pattern: /^\S{16,}$/, shapeHint: 'is the access token\'s ID', secret: true },
      { name: 'tokenSecret', label: 'Token secret', pattern: /^\S{16,}$/, shapeHint: 'is the access token\'s secret', secret: true },
    ],
  },
  {
    id: 'ramp',
    label: 'Ramp',
    brand: 'ramp',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['ramp'],
    howToConnect: {
      paste: {
        credential: 'API client ID and secret',
        access: ['transactions:read', 'reimbursements:read', 'bills:read', 'vendors:read', 'users:read', 'business:read'],
        getItAt: { url: 'https://app.ramp.com/settings/ramp-developer', steps: ['Create a new app', 'Grant it the read scopes listed above and the client credentials grant', 'Copy the client ID and secret'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Ramp developer app\'s client ID and secret',
    helpText: 'A Ramp developer app (Settings → Ramp Developer → Create new app) with the client credentials grant and read-only scopes: transactions, reimbursements, bills, vendors, users, business. Read-only: Vocion never issues a card, approves or pays.',
    fields: [
      { name: 'clientId', label: 'Client ID', pattern: /^\S{8,}$/, shapeHint: 'is the app\'s client ID (ramp_id_…)', secret: false },
      { name: 'clientSecret', label: 'Client secret', pattern: /^\S{8,}$/, shapeHint: 'is the app\'s client secret (ramp_sec_…)', secret: true },
    ],
  },
  {
    id: 'bill',
    label: 'BILL',
    brand: 'bill',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['bill'],
    howToConnect: {
      paste: {
        credential: 'API user sign-in and organization ID',
        access: ['A BILL user whose role can see bills, vendors, invoices and customers — read-only is enough', 'The developer key, unless this server has BILL_DEV_KEY'],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a BILL user\'s email and password, the organization ID, and a developer key when the server has none',
    helpText: 'A BILL (bill.com) user for the API — use a dedicated user with a read-only role — its organization ID (Settings → Sync & Integrations → Manage Developer Keys), and the developer key from the same page unless this server sets BILL_DEV_KEY. Vocion signs in per call and only reads: it never pays, approves or sends.',
    fields: [
      { name: 'username', label: 'User email', pattern: /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/, shapeHint: 'is the BILL user\'s email address', secret: false },
      { name: 'organizationId', label: 'Organization ID', pattern: /^\S{6,}$/, shapeHint: 'is the organization ID (starts 008…)', secret: false },
      { name: 'password', label: 'Password', pattern: null, shapeHint: 'is the user\'s password', secret: true },
      { name: 'devKey', label: 'Developer key', pattern: /^\S{8,}$/, shapeHint: 'is the developer key from Manage Developer Keys', secret: true, optional: true },
    ],
  },
  {
    id: 'gusto',
    label: 'Gusto',
    brand: 'gusto',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['gusto'],
    howToConnect: {
      // Login only: Gusto issues no API key, and its refresh token is single
      // use (each refresh returns the next), so only a saved login can keep it.
      login: { provider: 'gusto', access: ['The read scopes your Gusto app was approved for: companies, employees, departments, payrolls, time off'], settingsAfterLogin: [] },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Gusto login',
    helpText: 'A Gusto login, one company. Log in with Gusto on the Connectors page; there is no key to paste. Read-only, and work information only: personal details and individual pay never reach an agent.',
    fields: [],
  },
  {
    id: 'rippling',
    label: 'Rippling',
    brand: 'rippling',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['rippling'],
    howToConnect: {
      paste: {
        credential: 'API token',
        access: ['Company (read)', 'Employees: name, title, department, manager, work email, start and end dates, employment type, work location (read)', 'Departments (read)', 'Leave requests (read)'],
        getItAt: { url: 'https://app.rippling.com/developer', steps: ['Create an API token', 'Grant only the read fields listed above — leave SSN, date of birth, home address, compensation and bank details unticked'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Rippling API token',
    helpText: 'A Rippling API token (Settings → Company settings → API Access) granted only work fields: name, title, department, manager, work email, dates, employment type, work location, and leave requests. Leave personal fields unticked; Vocion drops any it is sent.',
    fields: singleKeyField('API token', /^\S{16,}$/, 'is the API token, at least 16 characters with no spaces'),
  },
  {
    id: 'workday',
    label: 'Workday',
    brand: 'workday',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['workday'],
    howToConnect: {
      paste: {
        credential: 'Integration system user (ISU) sign-in',
        access: ['Get access to the custom reports the source names (Report-as-a-Service, web service enabled)', 'Only work fields in those reports'],
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'the Workday services host, the tenant, and an integration system user\'s name and password',
    helpText: 'A Workday integration system user with access to the custom reports the source reads (Report-as-a-Service, "Enable as Web Service" on). The host is your services address (https://wd2-impl-services1.workday.com), the tenant the name in your Workday URL. Put only work fields in the reports; Vocion drops any personal field it is sent.',
    fields: [
      { name: 'host', label: 'Services host', pattern: /^https:\/\/[^\s/]+\/?$/i, shapeHint: 'is the https:// services host, e.g. https://wd2-impl-services1.workday.com', secret: false },
      { name: 'tenant', label: 'Tenant', pattern: /^[\w-]+$/, shapeHint: 'is the tenant name in your Workday URL', secret: false },
      { name: 'username', label: 'Integration user', pattern: /^\S+$/, shapeHint: 'is the integration system user\'s name', secret: false },
      { name: 'password', label: 'Password', pattern: null, shapeHint: 'is the integration system user\'s password', secret: true },
    ],
  },
  {
    id: 'google',
    label: 'Google',
    brand: 'google',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['gmail', 'drive', 'google-calendar', 'ga4', 'google-ads'],
    howToConnect: {
      // Each connector asks Google for its own read scope. A login also
      // carries the scopes the person granted this app before
      // (`include_granted_scopes`), so logging in for Gmail after Drive adds
      // Gmail rather than replacing Drive. Google Ads has no login: its API
      // also needs a developer token, which no login can issue.
      loginByConnector: {
        'gmail': { provider: 'google', access: ['https://www.googleapis.com/auth/gmail.readonly'], settingsAfterLogin: [] },
        'drive': { provider: 'google', access: ['https://www.googleapis.com/auth/drive.readonly'], settingsAfterLogin: [] },
        'google-calendar': { provider: 'google', access: ['https://www.googleapis.com/auth/calendar.readonly'], settingsAfterLogin: [] },
        'ga4': { provider: 'google', access: ['https://www.googleapis.com/auth/analytics.readonly'], settingsAfterLogin: [{ key: 'propertyId', label: 'Analytics property' }] },
      },
      paste: {
        credential: 'OAuth client and refresh token',
        access: [],
      },
    },
    // One OAuth consent covers every Google connector the workspace ticked, so
    // the same credential is meant to be pointed at by several sources.
    credentialsShareable: true,
    toolProvider: null,
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'an OAuth client id and secret plus the refresh token they minted',
    helpText: 'A Google OAuth client and the refresh token it minted, from `npm run google:oauth`. Gmail, Drive, Calendar, Analytics and Ads all authenticate with it. A refresh token keeps working; a bare access token expires in about an hour.',
    fields: [
      {
        name: 'clientId',
        label: 'OAuth client ID',
        pattern: null,
        shapeHint: 'is the client ID from the Google Cloud console',
        // Half of the OAuth client pair and not a secret — it travels in the
        // consent URL in the clear. Shown in full so two Google credentials
        // can be told apart by the project they belong to.
        secret: false,
      },
      {
        name: 'clientSecret',
        label: 'OAuth client secret',
        pattern: null,
        shapeHint: 'is the client secret from the Google Cloud console',
        secret: true,
      },
      {
        name: 'refreshToken',
        label: 'Refresh token',
        pattern: null,
        shapeHint: 'is the refresh token the consent returned',
        secret: true,
      },
      {
        name: 'developerToken',
        label: 'Google Ads developer token',
        pattern: null,
        shapeHint: 'is the developer token from the Google Ads manager account',
        secret: true,
        // Only the Ads connector sends it. Leaving it blank is right for a
        // workspace syncing Gmail, Drive, Calendar or Analytics.
        optional: true,
      },
    ],
  },
  {
    id: 'slack',
    label: 'Slack',
    brand: 'slack',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['slack'],
    howToConnect: {
      login: { provider: 'slack', access: ['channels:read', 'channels:history', 'groups:read', 'groups:history'], settingsAfterLogin: [] },
      paste: {
        credential: 'Bot token',
        access: ['channels:history', 'channels:read', 'The bot has to be in each channel you sync'],
        getItAt: { url: 'https://api.slack.com/apps', steps: ['Open your Slack app', 'Copy the bot token from OAuth & Permissions'] },
      },
    },
    // A bot token reads every channel it was invited to, and one source syncs
    // one channel, so a workspace watching several channels shares one token.
    credentialsShareable: true,
    toolProvider: null,
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Slack bot or user token, usually starting "xoxb-"',
    helpText: 'A Slack bot token, from your Slack app → OAuth & Permissions. Needs channels:history and channels:read, and the bot has to be in each channel you sync.',
    // Named `token` because that is the key the connector reads out of
    // `ctx.credentials`. The field name is the storage contract between the two.
    fields: [{ name: 'token', label: 'Bot token', pattern: null, shapeHint: 'is any non-empty token', secret: true }],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    brand: 'zoom',
    keySource: 'supplied',
    credentialsPerOrg: 'many',
    connectorSlugs: ['zoom'],
    howToConnect: {
      // Zoom sends no scope in the login URL: the scopes are the ones the
      // Marketplace app is registered with, listed here as Zoom names them.
      login: {
        provider: 'zoom',
        access: ['user:read:user', 'cloud_recording:read:list_user_recordings', 'cloud_recording:read:list_recording_files', 'cloud_recording:read:meeting_transcript'],
        settingsAfterLogin: [],
      },
      paste: {
        credential: 'Server-to-server OAuth app credentials',
        access: ['user:read:admin', 'cloud_recording:read:admin'],
      },
    },
    // A server-to-server app authenticates for the whole Zoom account, so
    // several sources scoped to different people share one set.
    credentialsShareable: true,
    toolProvider: null,
    llmProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Zoom account ID plus the app\'s client ID and secret',
    helpText: 'A Zoom server-to-server OAuth app, from the Zoom App Marketplace → Develop → Build App. Needs user:read:admin and cloud_recording:read:admin. All three values are on the app\'s Credentials page.',
    fields: [
      {
        name: 'accountId',
        label: 'Account ID',
        pattern: null,
        shapeHint: 'is the account ID on the app\'s Credentials page',
        // Identifies the Zoom account rather than authenticating it, so it is
        // shown in full and tells two Zoom credentials apart.
        secret: false,
      },
      {
        name: 'clientId',
        label: 'Client ID',
        pattern: null,
        shapeHint: 'is the client ID on the app\'s Credentials page',
        secret: false,
      },
      {
        name: 'clientSecret',
        label: 'Client secret',
        pattern: null,
        shapeHint: 'is the client secret on the app\'s Credentials page',
        secret: true,
      },
    ],
  },
  {
    id: 'google-analytics',
    label: 'Google Analytics',
    brand: 'googleanalytics',
    keySource: 'supplied',
    // ONE live credential, unlike every other connector platform, and the
    // reason is the shape of what points at it. A source install names the
    // credential row it uses, so Strapi can hold one per environment. A
    // `verified` measure names a CONNECTOR — `connector: web-analytics` — and
    // carries no row id, because a team's outcome contract is about what is
    // being measured, not about which stored secret to spend. With no id in
    // hand there has to be exactly one answer per workspace, so this platform
    // is `one-live` and `resolvePlatformCredential` can resolve it.
    credentialsPerOrg: 'one-live',
    // Not a source connector. The `ga4` INGEST connector authenticates with
    // the shared `google` OAuth credential and pulls report rows in as
    // documents; this platform is the read behind a measure, which is a
    // different question with a different credential and no sync.
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a service-account client email and private key, plus the property the report reads',
    helpText: 'A Google Cloud service account with the Viewer role on one GA4 property, and that property\'s numeric id. Used read-only, to answer `verified` measures from the Analytics Data API. The property id is workspace configuration and lives here rather than in a team file.',
    fields: [
      {
        name: 'propertyId',
        label: 'GA4 property ID',
        // Numeric, the value the Data API addresses as `properties/<id>`. Not
        // the `G-…` measurement id, which the Data API does not accept — the
        // pattern refuses that paste rather than letting it fail at read time.
        pattern: /^\d{6,}$/,
        shapeHint: 'is the numeric GA4 property ID (Admin → Property Settings), not the G-XXXXXXX measurement ID',
        // An identifier, not a secret, and shown back in full so two
        // workspaces' analytics credentials can be told apart by property.
        secret: false,
      },
      {
        name: 'clientEmail',
        label: 'Service account email',
        pattern: /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/,
        shapeHint: 'is the service account\'s email, ending .iam.gserviceaccount.com',
        // The `client_email` out of the JSON key file. It authenticates
        // nothing on its own — the private key does — so it is shown in full,
        // the same call the AWS access key id gets.
        secret: false,
      },
      {
        name: 'privateKey',
        label: 'Service account private key',
        // The `private_key` out of the same JSON key file, PEM-wrapped. Pasted
        // as its own field rather than as the whole JSON document: a JSON blob
        // in a single string field cannot be masked field by field, and the
        // other two values in it are ones we want shown.
        pattern: /-----BEGIN PRIVATE KEY-----/,
        shapeHint: 'is the private_key value from the service account JSON, beginning -----BEGIN PRIVATE KEY-----',
        secret: true,
      },
    ],
  },
  /* ---------------------------------------------------------------- */
  /* A business's numbers — warehouses, product analytics, ad platforms. */
  /* Each `one-live` for the reason Sentry and PostHog are: widening the */
  /* cap means rebuilding `api_token_org_platform_live_idx`. Every one is */
  /* read-only except Meta Ads, whose token may also pause and resume.   */
  /* ---------------------------------------------------------------- */
  {
    id: 'snowflake',
    label: 'Snowflake',
    brand: 'snowflake',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['snowflake'],
    howToConnect: {
      paste: {
        credential: 'Key pair (a user and its private key)',
        access: ['A role that can only read: USAGE on the warehouse, the database and each allowed schema, SELECT on their tables and views', 'Set it as the user\'s default role, or name it on the source'],
        getItAt: { url: 'https://docs.snowflake.com/en/user-guide/key-pair-auth', steps: ['Generate an RSA key pair', 'ALTER USER <user> SET RSA_PUBLIC_KEY = \'<public key>\'', 'Paste the user and the private key here'] },
      },
    },
    // One key-pair user reads every schema its role grants, and each source
    // narrows by its own allowlist, so several sources share the credential.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Snowflake account identifier, a user, and that user\'s RSA private key',
    helpText: 'A Snowflake user that signs in with a key pair (no password), and its private key. Give the user a role that can only read the schemas the source allows: Vocion refuses anything but a query, and the role is the wall underneath. The account identifier is the part of your Snowflake address before .snowflakecomputing.com.',
    fields: [
      {
        name: 'account',
        label: 'Account identifier',
        pattern: /^[a-z0-9][\w.-]*$/i,
        shapeHint: 'is the account identifier, e.g. northwind-analytics or xy12345.us-east-1 — the part of the address before .snowflakecomputing.com',
        // Where the key is spent; shown in full, and what tells one Snowflake
        // account apart from another in the credential list.
        secret: false,
      },
      {
        name: 'user',
        label: 'User',
        pattern: /^\S+$/,
        shapeHint: 'is the Snowflake user name, with no spaces',
        secret: false,
      },
      {
        name: 'privateKey',
        label: 'Private key',
        pattern: /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/,
        shapeHint: 'is a PEM private key, beginning -----BEGIN PRIVATE KEY----- (or -----BEGIN ENCRYPTED PRIVATE KEY-----)',
        secret: true,
      },
      {
        name: 'privateKeyPassphrase',
        label: 'Private key passphrase',
        pattern: null,
        shapeHint: 'is the passphrase the private key was encrypted with',
        secret: true,
        // Only an encrypted key has one.
        optional: true,
      },
    ],
  },
  {
    id: 'bigquery',
    label: 'BigQuery',
    brand: 'googlebigquery',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['bigquery'],
    howToConnect: {
      paste: {
        credential: 'Service account key',
        access: ['BigQuery Data Viewer on each allowed dataset', 'BigQuery Job User on the project that runs the queries'],
        getItAt: { url: 'https://cloud.google.com/iam/docs/keys-create-delete', steps: ['Make a service account with BigQuery Data Viewer and BigQuery Job User', 'Create a JSON key for it', 'Paste its project_id, client_email and private_key here'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'the project_id, client_email and private_key values from a service account\'s JSON key',
    helpText: 'A Google Cloud service account, from its JSON key file: the project that runs (and pays for) the queries, the service account\'s email, and its private key. Grant it BigQuery Data Viewer on the datasets the source allows and BigQuery Job User on the project — nothing that writes. Pasted as three values rather than the whole file, so the email and project stay readable and only the key is masked.',
    fields: [
      {
        name: 'projectId',
        label: 'Project ID',
        pattern: /^(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
        shapeHint: 'is the project_id from the key file, e.g. northwind-analytics',
        secret: false,
      },
      {
        name: 'clientEmail',
        label: 'Service account email',
        pattern: /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/,
        shapeHint: 'is the client_email from the key file, ending .iam.gserviceaccount.com',
        secret: false,
      },
      {
        name: 'privateKey',
        label: 'Private key',
        pattern: /-----BEGIN PRIVATE KEY-----/,
        shapeHint: 'is the private_key value from the key file, beginning -----BEGIN PRIVATE KEY-----',
        secret: true,
      },
    ],
  },
  {
    id: 'databricks',
    label: 'Databricks',
    brand: 'databricks',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['databricks'],
    howToConnect: {
      paste: {
        credential: 'Personal access token',
        access: ['CAN USE on the SQL warehouse', 'USE CATALOG, USE SCHEMA and SELECT on each allowed schema — nothing that writes'],
        getItAt: { url: 'https://docs.databricks.com/en/dev-tools/auth/pat.html', steps: ['In the workspace, Settings → Developer → Access tokens', 'Generate a token for a user or service principal that can only read', 'Paste it with the workspace URL'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Databricks workspace URL plus a personal access token',
    helpText: 'A Databricks personal access token (dapi…) and the workspace URL it was made in. Make it for a user or service principal that can use the SQL warehouse and only read the schemas the source allows: Vocion refuses anything but a query, and the grants are the wall underneath.',
    fields: [
      {
        name: 'host',
        label: 'Workspace URL',
        pattern: /^https:\/\/[^\s/]+\/?$/i,
        shapeHint: 'is the workspace address, e.g. https://dbc-1a2b3c4d-5e6f.cloud.databricks.com',
        // A token is worthless against any other workspace, so the two rotate
        // together; shown in full, as an identifier.
        secret: false,
      },
      {
        name: 'token',
        label: 'Personal access token',
        pattern: /^\S{16,}$/,
        shapeHint: 'is a personal access token, usually starting dapi, with no spaces',
        secret: true,
      },
    ],
  },
  {
    id: 'redshift',
    label: 'Amazon Redshift',
    brand: 'amazonredshift',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['redshift'],
    howToConnect: {
      paste: {
        credential: 'AWS access key pair or IAM role ARN',
        access: ['redshift-data:ExecuteStatement, DescribeStatement, GetStatementResult, ListSchemas, ListTables, DescribeTable', 'redshift-serverless:GetCredentials (serverless) or redshift:GetClusterCredentialsWithIAM (provisioned)', 'A database user that can only read the allowed schemas'],
        getItAt: { url: 'https://docs.aws.amazon.com/redshift/latest/mgmt/data-api-access.html', steps: ['Make an IAM user (or role) with the Data API permissions above', 'Paste its access key pair, or the role\'s ARN for Vocion to assume'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an AWS access key pair (AKIA… plus its secret), an IAM role ARN Vocion assumes, or a key pair and a role to assume with it',
    helpText: 'How Vocion signs Redshift Data API calls: an IAM access key pair, the same shape the AWS credential takes; or the ARN of a role in your account that Vocion assumes (its trust policy names the external ID Test connection shows); or both, to assume the role with the key. Scope it to the Data API and a database user that can only read the allowed schemas: queries also run in a READ ONLY transaction.',
    fields: [
      {
        name: 'accessKeyId',
        label: 'Access key ID',
        pattern: /^(?:AKIA|ASIA)[A-Z0-9]{12,}$/,
        shapeHint: 'starts with AKIA or ASIA followed by at least 12 more characters',
        secret: false,
        optional: true,
      },
      {
        name: 'secretAccessKey',
        label: 'Secret access key',
        pattern: /^[A-Z0-9/+=]{40,}$/i,
        shapeHint: 'is at least 40 characters',
        secret: true,
        optional: true,
      },
      {
        name: 'roleArn',
        label: 'IAM role ARN to assume',
        pattern: /^arn:aws[\w-]*:iam::\d{12}:role\/[\w+=,.@/-]+$/,
        shapeHint: 'is a role ARN, e.g. arn:aws:iam::123456789012:role/vocion-redshift-read',
        secret: false,
        optional: true,
      },
    ],
  },
  {
    id: 'mixpanel',
    label: 'Mixpanel',
    brand: 'mixpanel',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['mixpanel'],
    howToConnect: {
      paste: {
        credential: 'Service account',
        access: ['The Consumer role on the project the source reads'],
        getItAt: { url: 'https://docs.mixpanel.com/docs/orgs-and-projects/service-accounts', steps: ['Organization settings → Service accounts → Add', 'Give it the Consumer role on the project', 'Paste its username and secret'] },
      },
    },
    // One service account can be given several projects; each source names its own.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Mixpanel service account username and its secret',
    helpText: 'A Mixpanel service account (Organization settings → Service accounts) with the Consumer role on the project the source reads — read-only. The project id and its data region are set on the source.',
    fields: [
      {
        name: 'username',
        label: 'Service account username',
        pattern: /^\S+$/,
        shapeHint: 'is the service account\'s username, with no spaces',
        secret: false,
      },
      {
        name: 'secret',
        label: 'Service account secret',
        pattern: /^\S{8,}$/,
        shapeHint: 'is the secret shown once when the service account was made',
        secret: true,
      },
    ],
  },
  {
    id: 'amplitude',
    label: 'Amplitude',
    brand: 'amplitude',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['amplitude'],
    howToConnect: {
      paste: {
        credential: 'API key and secret key',
        access: ['The project\'s own key pair, from Settings → Projects → <project> → General'],
      },
    },
    // A key pair belongs to one project, so a second source over it reads the same thing.
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'an Amplitude project\'s API key and secret key',
    helpText: 'The API key and secret key of the Amplitude project the source reads (Settings → Projects → your project → General). Used read-only, against the Dashboard REST API: Vocion sends no events with them. The data region is set on the source.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        pattern: /^\w{16,}$/,
        shapeHint: 'is the project\'s API key, letters and digits',
        // The API key also ships inside the app's tracking code, so it is not
        // a secret; shown in full, it tells two projects apart.
        secret: false,
      },
      {
        name: 'secretKey',
        label: 'Secret key',
        pattern: /^\w{16,}$/,
        shapeHint: 'is the project\'s secret key, letters and digits',
        secret: true,
      },
    ],
  },
  {
    id: 'linkedin-ads',
    label: 'LinkedIn Ads',
    brand: 'linkedin',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['linkedin-ads'],
    howToConnect: {
      login: {
        provider: 'linkedin',
        access: ['r_ads', 'r_ads_reporting'],
        settingsAfterLogin: [{ key: 'accountId', label: 'ad account' }],
      },
      paste: {
        credential: 'Access token',
        access: ['r_ads', 'r_ads_reporting', 'A role on the ad account (Viewer is enough)'],
        getItAt: { url: 'https://www.linkedin.com/developers/tools/oauth/token-generator', steps: ['Pick an app with the Advertising API product', 'Tick r_ads and r_ads_reporting', 'Paste the access token (it lasts 60 days)'] },
      },
    },
    // One member's token reaches every ad account the member has a role on;
    // each source names its own account.
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a LinkedIn access token with r_ads and r_ads_reporting',
    helpText: 'A LinkedIn access token with r_ads and r_ads_reporting, for a member with a role on the ad account — read-only: Vocion reads campaigns and their performance and changes nothing on LinkedIn. A pasted token lasts 60 days; logging in with LinkedIn renews itself where LinkedIn allows.',
    // Named `token` to match what the connector reads out of the credential bag.
    fields: [{ name: 'token', label: 'Access token', pattern: /^\S{16,}$/, shapeHint: 'is an access token with no spaces', secret: true }],
  },
  {
    id: 'meta-ads',
    label: 'Meta Ads',
    brand: 'meta',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: ['meta-ads'],
    howToConnect: {
      paste: {
        credential: 'System user access token',
        access: ['ads_read', 'ads_management, only if Vocion may pause and resume', 'The ad account assigned to the system user'],
        getItAt: { url: 'https://business.facebook.com/settings/system-users', steps: ['Business settings → Users → System users → Add', 'Assign it the ad account', 'Generate a token with ads_read (and ads_management to pause and resume)'] },
      },
    },
    credentialsShareable: true,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a Meta system user access token',
    helpText: 'A Meta Business system user token (Business settings → System users) assigned the ad account. ads_read reads campaigns and insights; add ads_management only if an agent may pause and resume — every pause is a card a person decides, with Undo. A system user token does not expire unless you set it to.',
    fields: [{ name: 'token', label: 'System user access token', pattern: /^\S{16,}$/, shapeHint: 'is an access token with no spaces', secret: true }],
  },
  {
    id: 'tavily',
    label: 'Tavily',
    brand: 'tavily',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: 'tavily',
    // Tavily keys carry a `tvly-` prefix, including the `tvly-dev-` variant.
    keyPattern: /^tvly-[\w-]{8,}$/i,
    keyShapeHint: 'starts with "tvly-" followed by at least 8 more characters',
    helpText: 'Your Tavily API key, from app.tavily.com. Web searches this workspace runs bill your Tavily account.',
    fields: singleKeyField('Tavily key', /^tvly-[\w-]{8,}$/i, 'starts with "tvly-" followed by at least 8 more characters'),
  },
  {
    id: 'brave',
    label: 'Brave Search',
    brand: 'brave',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: 'brave',
    // Brave subscription tokens are opaque and their shape is not documented,
    // so anything non-empty is accepted rather than risk rejecting a good key.
    keyPattern: null,
    keyShapeHint: 'is any non-empty subscription token',
    helpText: 'Your Brave Search API subscription token, from api-dashboard.search.brave.com. Web searches this workspace runs bill your Brave account.',
    fields: singleKeyField('Brave subscription token', null, 'is any non-empty subscription token'),
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    brand: 'firecrawl',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: 'firecrawl',
    // Firecrawl keys carry an `fc-` prefix.
    keyPattern: /^fc-[\w-]{8,}$/i,
    keyShapeHint: 'starts with "fc-" followed by at least 8 more characters',
    helpText: 'Your Firecrawl API key, from firecrawl.dev. Pages this workspace fetches through Firecrawl bill your Firecrawl account.',
    fields: singleKeyField('Firecrawl key', /^fc-[\w-]{8,}$/i, 'starts with "fc-" followed by at least 8 more characters'),
  },
  {
    id: 'app-login',
    label: 'App sign-in',
    keySource: 'supplied',
    // `many`: a workspace that builds products holds one sign-in per product
    // environment it checks (2026-09-30: the factory's QA signs in to each
    // product's production app to capture live evidence after a release). An
    // environment record names the row it uses (`qaLoginCredentialId`).
    credentialsPerOrg: 'many',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
    keyPattern: null,
    keyShapeHint: 'a sign-in URL, an email and a password',
    helpText: 'A sign-in to an app this workspace builds, for its QA to use: the sign-in page, the account email and its password. Use a dedicated QA account, never a person\'s own. Stored encrypted; only agents granted product_access can read it.',
    fields: [
      {
        name: 'signInUrl',
        label: 'Sign-in page',
        pattern: /^https?:\/\/\S+$/i,
        shapeHint: 'starts with http:// or https://',
        secret: false,
      },
      {
        name: 'email',
        label: 'Account email',
        pattern: /^\S[^\s@]*@\S+$/,
        shapeHint: 'is an email address',
        // Non-secret, so the credential list shows which account this is.
        secret: false,
      },
      {
        name: 'password',
        label: 'Password',
        pattern: null,
        shapeHint: 'is any non-empty password',
        secret: true,
      },
    ],
  },
  ...LOGIN_APP_PLATFORMS,
  {
    id: 'custom',
    label: 'Other platform',
    keySource: 'supplied',
    credentialsPerOrg: 'one-live',
    connectorSlugs: [],
    credentialsShareable: false,
    llmProvider: null,
    toolProvider: null,
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
  if (platform.fields.length === 0) {
    // Nothing to paste (QuickBooks): an empty credential would save and then
    // fail every sync, so the only way in is the login.
    throw new CredentialValidationError(`${platform.label} has no key to paste. Log in with ${platform.label} on the Connectors page instead.`);
  }
  const values: CredentialValues = {};
  for (const field of platform.fields) {
    const value = (rawValues[field.name] ?? '').trim();
    if (value.length === 0) {
      if (field.optional === true) {
        continue;
      }
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
  return PLATFORMS.find(platform => platform.connectorSlugs.includes(slug)) ?? null;
}

/**
 * Whether two sources may point at the same stored credential for `id`.
 *
 * A credential issued for one place must not be, since the second source would
 * only fail; an account-wide grant must be, or a workspace syncing five Slack
 * channels would have to paste the same bot token five times.
 * @param id - The platform to ask about.
 */
export function credentialsAreShareable(id: CredentialPlatformId): boolean {
  return getPlatform(id).credentialsShareable;
}

/**
 * The platform whose credential authenticates the `provider` tool provider, or
 * `null` when that provider needs no key — the builtin page extractor and the
 * calculator call nothing, and the anthropic-native search placeholder
 * authenticates with the org's Anthropic key rather than one of its own.
 * @param provider - A tool provider name, e.g. `tavily`.
 */
export function platformForToolProvider(provider: string): CredentialPlatform | null {
  return PLATFORMS.find(platform => platform.toolProvider === provider) ?? null;
}

/**
 * Every vendor login-app platform, one per connect provider that takes a
 * workspace's own client ID and secret.
 */
export function loginAppPlatforms(): readonly CredentialPlatform[] {
  return LOGIN_APP_PLATFORMS;
}

/**
 * The login-app platform for a connect provider, or `null` when a workspace
 * cannot bring its own app for it (GitHub, PostHog).
 * @param provider - A connect provider id, e.g. `google`.
 */
export function loginAppPlatformFor(provider: ConnectProviderId): CredentialPlatform | null {
  return PLATFORMS.find(platform => platform.loginAppFor === provider) ?? null;
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
  // Required only: an optional field may hold nothing, and a hint drawn from a
  // blank value tells the list nothing about which credential this row is.
  const secrets = platform.fields.filter(field => field.secret && field.optional !== true);
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

/**
 * How to connect the platform behind a connector, or null when no platform
 * claims the connector. The Connectors form and the chat connect card read
 * this rather than special-casing providers (#1080).
 *
 * On a platform that declares `loginByConnector`, the connector's own entry
 * comes back as `login`, and a connector with no entry comes back with no
 * login, so Gmail gets Gmail's scope and Google Ads gets paste only.
 * @param connectorSlug - A source's connector slug, e.g. `jira`.
 */
export function howToConnectFor(connectorSlug: string): Omit<NonNullable<CredentialPlatform['howToConnect']>, 'loginByConnector'> | null {
  const howToConnect = platformForConnectorSlug(connectorSlug)?.howToConnect;
  if (!howToConnect) {
    return null;
  }
  const { loginByConnector, ...declaration } = howToConnect;
  if (!loginByConnector) {
    return declaration;
  }
  const login = Object.hasOwn(loginByConnector, connectorSlug) ? loginByConnector[connectorSlug] : undefined;
  return { ...(declaration.paste ? { paste: declaration.paste } : {}), ...(login ? { login } : {}) };
}

/** Google writes its scopes as URLs; people know them by the part after this. */
const GOOGLE_SCOPE_PREFIX = 'https://www.googleapis.com/auth/';

/**
 * A login's access as the form and the chat card show it: Google's scope URLs
 * shrink to their names (`gmail.readonly`), and every other vendor's scopes
 * are short already.
 * @param access - The login's `access` lines.
 */
export function accessForDisplay(access: readonly string[]): string {
  return access.map(line => (line.startsWith(GOOGLE_SCOPE_PREFIX) ? line.slice(GOOGLE_SCOPE_PREFIX.length) : line)).join(', ');
}

/**
 * Whether logging in is all it takes: the connector declares a login and
 * names no setting the source still needs.
 * @param connectorSlug - A source's connector slug, e.g. `slack`.
 */
export function loginIsEnough(connectorSlug: string): boolean {
  const login = howToConnectFor(connectorSlug)?.login;
  return Boolean(login) && login!.settingsAfterLogin.length === 0;
}

/**
 * What happens after the login, in a person's words, from the declaration:
 * the one sentence the form and the chat card both show.
 * @param settings - The login's `settingsAfterLogin`.
 */
export function afterLoginText(settings: readonly { label: string }[]): string {
  return settings.length === 0
    ? 'Logging in is all it takes; the source is added for you.'
    : `After logging in you choose: ${settings.map(setting => setting.label).join(', ')}.`;
}
