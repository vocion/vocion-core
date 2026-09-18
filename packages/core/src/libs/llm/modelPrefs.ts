/**
 * Per-conversation model preferences — how strong a model, how much it
 * thinks — chosen by the person in the composer (Chris, 2026-09-18: "why
 * don't I have tools when chatting to control reasoning level or model
 * strength?").
 *
 * Pure: the server maps a preference onto a vendor's model id and thinking
 * budget, the client shows the same words. Neither side sees a model id in
 * the UI — a person picks fast / balanced / deep, not a version string.
 *
 *   strength  fast → the vendor's small model; balanced → the agent's own
 *             (nothing overridden); deep → the vendor's largest.
 *   effort    off → no extended thinking; low / medium / high → a budget,
 *             or adaptive thinking on models that size their own.
 */

/** The vendors a preference can be mapped onto — the same alphabet as `langchain.ts`'s `PrefsProvider`, spelled here so this module never imports the LLM module (the Temporal worker reaches it). */
export type PrefsProvider = 'anthropic' | 'openai' | 'bedrock' | 'scripted';

export const MODEL_STRENGTHS = ['fast', 'balanced', 'deep'] as const;
export type ModelStrength = (typeof MODEL_STRENGTHS)[number];

export const THINKING_EFFORTS = ['off', 'low', 'medium', 'high'] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

export type ModelPrefs = { strength: ModelStrength; effort: ThinkingEffort };

export const DEFAULT_MODEL_PREFS: ModelPrefs = { strength: 'balanced', effort: 'off' };

/** The vendor's small and large models. `balanced` is deliberately absent: it means "the agent's own". */
const STRENGTH_MODELS: Record<Exclude<PrefsProvider, 'scripted'>, { fast: string; deep: string }> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', deep: 'claude-opus-5' },
  openai: { fast: 'gpt-4o-mini', deep: 'gpt-4o' },
  bedrock: { fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', deep: 'us.anthropic.claude-opus-5' },
};

/** Thinking budgets in tokens, for models that take one. Anthropic's floor is 1024. */
const THINKING_BUDGETS: Record<Exclude<ThinkingEffort, 'off'>, number> = { low: 2048, medium: 8192, high: 24_000 };

/**
 * The model a strength selects on a provider, or undefined for `balanced`
 * (leave the agent's own model alone) and for the scripted test provider.
 * @param provider
 * @param strength
 */
export function modelForStrength(provider: PrefsProvider, strength: ModelStrength): string | undefined {
  if (strength === 'balanced' || provider === 'scripted') {
    return undefined;
  }
  return STRENGTH_MODELS[provider][strength];
}

/**
 * The thinking budget an effort asks for, or null for `off`.
 * @param effort
 */
export function thinkingBudgetFor(effort: ThinkingEffort): number | null {
  return effort === 'off' ? null : THINKING_BUDGETS[effort];
}

/**
 * Whether the prefs ask for anything beyond the agent's own defaults.
 * @param prefs
 */
export function isDefaultModelPrefs(prefs: ModelPrefs): boolean {
  return prefs.strength === 'balanced' && prefs.effort === 'off';
}

/**
 * Parse whatever a client or a row says into prefs, defaulting anything odd.
 * @param raw - `{ strength?, effort? }` or `{ modelStrength?, thinkingEffort? }`, possibly nonsense.
 */
export function readModelPrefs(raw: unknown): ModelPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = r.strength ?? r.modelStrength ?? r.model_strength;
  const e = r.effort ?? r.thinkingEffort ?? r.thinking_effort;
  return {
    strength: MODEL_STRENGTHS.includes(s as ModelStrength) ? (s as ModelStrength) : 'balanced',
    effort: THINKING_EFFORTS.includes(e as ThinkingEffort) ? (e as ThinkingEffort) : 'off',
  };
}

/**
 * A short human name for a model id: `claude-sonnet-5` → `Sonnet 5`, `us.anthropic.claude-haiku-4-5-20251001-v1:0` → `Haiku 4.5`.
 * @param id
 */
export function shortModelName(id: string): string {
  const base = id.replace(/^us\.anthropic\./, '').replace(/-v\d+:\d+$/, '').replace(/^claude-/, '');
  const m = /^(haiku|sonnet|opus|fable|mythos)-(\d+)(?:-(\d+))?/.exec(base);
  if (m) {
    return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  }
  return base;
}
