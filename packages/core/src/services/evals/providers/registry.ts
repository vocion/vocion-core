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

registerProvider(vocionProvider);
registerProvider(agentcoreProvider);
