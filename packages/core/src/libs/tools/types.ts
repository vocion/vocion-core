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

/** Reported to the dashboard Tools catalog so users see provider/key status. */
export type CapabilityStatus = {
  capability: string;
  provider: string;
  /** true when the active provider has everything it needs to run. */
  ready: boolean;
  /** env vars that are missing (empty when ready). */
  missingEnv: string[];
};
