/**
 * Registry of eval score providers.
 *
 * Mirrors `libs/sources/registry.ts`, which solves the same problem for source
 * connectors: one map, registered on import, read by both the runner and the
 * UI. Following it means a reviewer who knows one knows the other, and a third
 * provider is a module plus one `registerProvider` line.
 *
 * Order matters only in that `vocion` is registered first, so a run started
 * without a named provider grades with our own judge — the behaviour every
 * existing caller already depends on.
 */

import type { EvalScoreProvider } from './types';
import { agentcoreProvider } from './agentcore';
import { vocionProvider } from './vocion';

const registry = new Map<string, EvalScoreProvider>();

export function registerProvider(provider: EvalScoreProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: string): EvalScoreProvider | undefined {
  return registry.get(id);
}

export function listProviders(): EvalScoreProvider[] {
  return Array.from(registry.values());
}

/**
 * The providers this org can actually use right now.
 *
 * Asks each one rather than reading a flag, because availability is a fact
 * about the org's credentials and region, not a setting someone remembered to
 * turn on. A provider that throws while answering is treated as unavailable —
 * being unable to tell is not a reason to try grading with it.
 * @param orgId - Whose credentials to check.
 */
export async function listAvailableProviders(orgId: string): Promise<EvalScoreProvider[]> {
  const available: EvalScoreProvider[] = [];
  for (const provider of listProviders()) {
    try {
      const availability = await provider.isAvailable(orgId);
      if (availability.available) {
        available.push(provider);
      }
    } catch (error) {
      console.error(`[evals] could not tell whether ${provider.id} is available for ${orgId}`, error);
    }
  }
  return available;
}

/** One provider as the dashboard needs to show it. */
export type ProviderDescription = {
  id: string;
  label: string;
  available: boolean;
  /** Why not, when it is unavailable. Empty when it is. */
  reason: string;
  /**
   * True when this grader keeps a copy of the dataset in its own account.
   *
   * The page needs this before anything has been published, to tell "this
   * eval's cases have not reached AWS yet" from "this grader reads the cases
   * out of Postgres and never will".
   */
  keepsDataset: boolean;
};

/**
 * Every provider, with whether this org can use it and why not.
 *
 * The UI needs the unavailable ones too, but only sometimes: a provider that
 * is off because nobody set up AWS should stay invisible, while one that is
 * off because the region has no AgentCore Evaluations needs saying out loud,
 * or every run reads as the agent being broken. Handing back the reason lets
 * the page make that call instead of guessing from a boolean.
 * @param orgId - Whose credentials to check.
 */
export async function describeProviders(orgId: string): Promise<ProviderDescription[]> {
  const described: ProviderDescription[] = [];
  for (const provider of listProviders()) {
    try {
      const availability = await provider.isAvailable(orgId);
      described.push({
        id: provider.id,
        label: provider.label,
        available: availability.available,
        reason: availability.reason,
        keepsDataset: typeof provider.publishDataset === 'function',
      });
    } catch (error) {
      console.error(`[evals] could not tell whether ${provider.id} is available for ${orgId}`, error);
      described.push({
        id: provider.id,
        label: provider.label,
        available: false,
        reason: (error as Error).message ?? 'could not check availability',
        keepsDataset: typeof provider.publishDataset === 'function',
      });
    }
  }
  return described;
}

registerProvider(vocionProvider);
registerProvider(agentcoreProvider);
