/**
 * Shared types for built-in agent tool capabilities (web search, browse,
 * image generation, code/artifacts). Each capability lives under
 * `libs/tools/<cap>/` with a provider interface + an env-driven registry
 * that mirrors the `libs/llm/` provider pattern.
 */

/**
 * Thrown by a provider (or its registry) when the active provider is
 * selected but its required configuration (e.g. an API key) is missing.
 * Tool factories catch this and return a clear, non-fatal message to the
 * model instead of throwing — so an agent degrades gracefully rather than
 * crashing a turn.
 */
export class ProviderNotConfiguredError extends Error {
  readonly capability: string;
  readonly provider: string;
  readonly missingEnv: string[];
  constructor(capability: string, provider: string, missingEnv: string[]) {
    super(
      `${capability} provider "${provider}" is not configured — set ${missingEnv.join(', ')}.`,
    );
    this.name = 'ProviderNotConfiguredError';
    this.capability = capability;
    this.provider = provider;
    this.missingEnv = missingEnv;
  }
}

/**
 * Thrown when the org's own key could not be read at all — the credential
 * store was unreachable, or the stored ciphertext no longer opens.
 *
 * Distinct from {@link ProviderNotConfiguredError}, which means "nobody has a
 * key". This one means "somebody might, and we could not find out", and the
 * two need opposite handling: a missing key is a setup problem the workspace
 * can fix, while an unreadable one must stop the call rather than quietly
 * spend the deployment's account instead.
 *
 * It carries its own plain message on purpose. The underlying database or
 * decryption error is logged where it happens and deliberately not repeated
 * here, because a tool's failure text is handed straight to the model.
 */
export class ToolProviderKeyUnavailableError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`the workspace's stored ${provider} key could not be read`);
    this.name = 'ToolProviderKeyUnavailableError';
    this.provider = provider;
  }
}

/**
 * Where the key a capability is about to spend comes from.
 *
 * `workspace` — the org pasted its own key, so its account is billed.
 * `server` — the deployment's env var is in use.
 * `none` — either the provider needs no key at all (the builtin page
 * extractor, the calculator) or nobody has one, which `ready` tells apart.
 * `unknown` — the credential store could not be read, so whether this
 * workspace holds a key of its own is genuinely not known. Distinct from
 * `none` because the call path refuses outright in that state rather than
 * falling back to the deployment's key, and a page claiming "running on the
 * Vocion server key" while every search fails is worse than one that admits
 * it could not check.
 */
export type CapabilityKeySource = 'workspace' | 'server' | 'none' | 'unknown';

/** Reported to the dashboard Tools catalog so users see provider/key status. */
export type CapabilityStatus = {
  capability: string;
  provider: string;
  /** true when the active provider has everything it needs to run. */
  ready: boolean;
  /** env vars that are missing (empty when ready). */
  missingEnv: string[];
  /** Whose key the capability spends. See {@link CapabilityKeySource}. */
  keySource: CapabilityKeySource;
  /**
   * Masked tail of the workspace's stored key, when that is the key in use.
   * A mask, never the secret — it is what the settings surface shows so the
   * page needs no second query of its own.
   */
  storedKeyHint?: string | null;
};
