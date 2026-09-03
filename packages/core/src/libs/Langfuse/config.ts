/**
 * One place that decides whether Langfuse tracing is on, and with what
 * credentials.
 *
 * Before this module the same three fallbacks (`pk-lf-vocion-demo`,
 * `sk-lf-vocion-demo`, `http://localhost:3200`) were repeated in five
 * files. A deployment that never set the real values still got a live
 * tracer aimed at a port nothing was listening on, so every trace
 * failed and nobody found out. The rules below replace that with an
 * explicit decision.
 *
 * Resolution order:
 *
 *   1. `LANGFUSE_ENABLED=false` — tracing off. No credentials needed,
 *      and nothing is validated. Use this for a client who does not
 *      want traces, or a local checkout that is not running the
 *      Langfuse container.
 *   2. `LANGFUSE_ENABLED=true` — tracing on, credentials required.
 *      Missing keys throw, because the operator asked for tracing and
 *      silently not tracing is worse than a boot failure.
 *   3. Unset — on when both keys are present, off when they are not.
 *      Outside production the local development defaults fill in, so a
 *      fresh checkout running `npm run dev:up` traces with no extra
 *      configuration.
 *
 * Everything reads `process.env` directly rather than `libs/Env.ts`,
 * because the standalone scripts (`smoke-langfuse`, `langfuse-bootstrap`,
 * the Temporal worker) run outside the Next.js runtime where that
 * module's other required variables are not present.
 */

/** The local `infra/docker-compose.platform.yml` container. */
export const LOCAL_DEVELOPMENT_BASE_URL = 'http://localhost:3200';

/**
 * Keys seeded by the local compose file via `LANGFUSE_INIT_PROJECT_*`.
 * These are deliberately public and deliberately worthless — they only
 * ever authenticate against a container on the developer's own laptop.
 */
export const LOCAL_DEVELOPMENT_PUBLIC_KEY = 'pk-lf-vocion-demo';
export const LOCAL_DEVELOPMENT_SECRET_KEY = 'sk-lf-vocion-demo';
export const LOCAL_DEVELOPMENT_PROJECT_ID = 'demo';

export type LangfuseDisabled = {
  enabled: false;
  /** Why tracing is off, for the one-time startup log. */
  reason: 'turned off by LANGFUSE_ENABLED' | 'no credentials configured';
};

export type LangfuseEnabled = {
  enabled: true;
  publicKey: string;
  secretKey: string;
  /** Where the SDK posts traces. Internal hostnames are fine here. */
  baseUrl: string;
  projectId: string;
  /**
   * Where a browser should be sent for "open this trace" links. Differs
   * from `baseUrl` on a self-hosted box, where the app reaches Langfuse
   * over the private compose network (`http://langfuse-web:3000`) but a
   * person needs the public hostname.
   */
  browserBaseUrl: string;
};

export type LangfuseConfig = LangfuseDisabled | LangfuseEnabled;

/**
 * Read an environment variable, treating blank and whitespace-only
 * values as absent. Deployment tooling frequently writes an empty
 * string for "unset", and an empty API key is not a usable one.
 * @param name - Environment variable to read.
 */
function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  return trimmed;
}

/**
 * Parse `LANGFUSE_ENABLED`. Unset returns undefined, which means "decide
 * from whether credentials are present" rather than a hard on or off.
 */
function readEnabledFlag(): boolean | undefined {
  const raw = readOptionalEnv('LANGFUSE_ENABLED');
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(
    `LANGFUSE_ENABLED must be one of true/false/1/0/yes/no, got "${raw}".`,
  );
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Build the enabled config, applying local development defaults for
 * anything the environment did not supply.
 *
 * Only called once the caller has decided tracing should be on, so a
 * missing key here is a real misconfiguration rather than a signal to
 * turn tracing off.
 * @param publicKey - Resolved `LANGFUSE_PUBLIC_KEY`, if any.
 * @param secretKey - Resolved `LANGFUSE_SECRET_KEY`, if any.
 */
function buildEnabledConfig(
  publicKey: string | undefined,
  secretKey: string | undefined,
): LangfuseEnabled {
  const allowLocalDefaults = !isProduction();

  const resolvedPublicKey = publicKey
    ?? (allowLocalDefaults ? LOCAL_DEVELOPMENT_PUBLIC_KEY : undefined);
  const resolvedSecretKey = secretKey
    ?? (allowLocalDefaults ? LOCAL_DEVELOPMENT_SECRET_KEY : undefined);

  const missing: string[] = [];
  if (!resolvedPublicKey) {
    missing.push('LANGFUSE_PUBLIC_KEY');
  }
  if (!resolvedSecretKey) {
    missing.push('LANGFUSE_SECRET_KEY');
  }
  if (missing.length > 0) {
    throw new Error(
      `Langfuse tracing is enabled but ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set. `
      + 'Set the missing value, or set LANGFUSE_ENABLED=false to run without tracing. '
      + 'See docs/deployment/observability.md.',
    );
  }

  const baseUrl = readOptionalEnv('LANGFUSE_BASE_URL')
    ?? (allowLocalDefaults ? LOCAL_DEVELOPMENT_BASE_URL : undefined);
  if (!baseUrl) {
    throw new Error(
      'Langfuse tracing is enabled but LANGFUSE_BASE_URL is not set. '
      + 'Use https://cloud.langfuse.com for Langfuse Cloud, or the internal '
      + 'hostname of a self-hosted instance. See docs/deployment/observability.md.',
    );
  }

  const projectId = readOptionalEnv('LANGFUSE_PROJECT_ID') ?? LOCAL_DEVELOPMENT_PROJECT_ID;

  return {
    enabled: true,
    publicKey: resolvedPublicKey as string,
    secretKey: resolvedSecretKey as string,
    baseUrl,
    projectId,
    // Self-hosted deployments reach Langfuse over the compose network,
    // which a browser cannot resolve. NEXT_PUBLIC_LANGFUSE_BASE_URL is
    // the externally reachable mirror; fall back to baseUrl for Cloud
    // and for local development, where the two are the same.
    browserBaseUrl: readOptionalEnv('NEXT_PUBLIC_LANGFUSE_BASE_URL') ?? baseUrl,
  };
}

/**
 * Decide whether Langfuse tracing is on, and gather the credentials if
 * it is. Throws only when the operator explicitly turned tracing on and
 * left it unconfigured.
 */
export function resolveLangfuseConfig(): LangfuseConfig {
  const enabledFlag = readEnabledFlag();

  if (enabledFlag === false) {
    return { enabled: false, reason: 'turned off by LANGFUSE_ENABLED' };
  }

  const publicKey = readOptionalEnv('LANGFUSE_PUBLIC_KEY');
  const secretKey = readOptionalEnv('LANGFUSE_SECRET_KEY');

  if (enabledFlag === true) {
    return buildEnabledConfig(publicKey, secretKey);
  }

  // Flag unset. Credentials decide — except outside production, where
  // the local compose defaults stand in so a fresh checkout traces
  // without anyone editing an env file.
  const hasCredentials = Boolean(publicKey && secretKey);
  if (hasCredentials || !isProduction()) {
    return buildEnabledConfig(publicKey, secretKey);
  }

  return { enabled: false, reason: 'no credentials configured' };
}

/**
 * The project ID a browser link should use. Mirrors
 * `browserBaseUrl` — self-hosted deploys can run a different project ID
 * in the public URL than the SDK posts to, though they usually do not.
 * @param config - Resolved config for the current process.
 */
export function browserProjectId(config: LangfuseEnabled): string {
  return readOptionalEnv('NEXT_PUBLIC_LANGFUSE_PROJECT_ID') ?? config.projectId;
}
