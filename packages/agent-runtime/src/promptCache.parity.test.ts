/**
 * The two copies of the prompt-cache module must not drift.
 *
 * `packages/agent-runtime/src/promptCache.ts` is a hand copy of
 * `packages/core/src/libs/llm/promptCache.ts`. The copy is deliberate — the
 * runtime artifact is bundled and deployed on its own and cannot import core,
 * the same reason `anthropicOmitsSampling` is duplicated — but a comment
 * saying "keep the two in step" is not a mechanism, and the drift is silent:
 * caching quietly stops on one runtime, or the kill switch stops working
 * there, and nothing fails until someone reads a bill.
 *
 * Three things are compared, chosen because each one's drift is invisible:
 *
 *   1. The TTL and cache type sent to the vendor. A five-minute cache on one
 *      side and an hour on the other is a 1.6x difference in write cost with
 *      no visible symptom.
 *   2. Which entry points each class overrides. `_streamChatModelEvents` is
 *      the one `BaseChatModel.stream()` prefers; a copy that has only the
 *      other two caches nothing on the path the agent runs.
 *   3. The values the kill switch accepts. `VOCION_PROMPT_CACHE=off` working
 *      in one process and not the other is the worst kind of incident switch.
 *
 * Compared as source text rather than by importing core, because importing
 * across the package boundary is the exact thing the copy exists to avoid.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_COPY = join(HERE, 'promptCache.ts');
const CORE_COPY = join(HERE, '..', '..', 'core', 'src', 'libs', 'llm', 'promptCache.ts');

const runtimeSource = readFileSync(RUNTIME_COPY, 'utf8');
const coreSource = readFileSync(CORE_COPY, 'utf8');

/**
 * The cache instruction literal the module sends, as written.
 * @param source - The module's source text.
 */
function cacheControlLiteral(source: string): string {
  const match = source.match(/DEFAULT_CACHE_CONTROL\s*=\s*(\{[^}]*\})/);
  if (!match?.[1]) {
    throw new Error('no DEFAULT_CACHE_CONTROL found — did the constant get renamed?');
  }
  return match[1].replace(/\s+/g, ' ').trim();
}

/**
 * Every chat-model entry point the module overrides, sorted and de-duplicated.
 * @param source - The module's source text.
 */
function overriddenEntryPoints(source: string): string[] {
  const names = [...source.matchAll(/override\s+(?:async\s*\*\s*)?(_\w+)\s*\(/g)].map(m => m[1]!);
  return [...new Set(names)].sort();
}

/**
 * The environment-variable values the kill switch treats as "off", sorted.
 * @param source - The module's source text.
 */
function killSwitchOffValues(source: string): string[] {
  const body = source.match(/function promptCacheAllowed\(\)[^}]*\}/)?.[0] ?? '';
  return [...body.matchAll(/raw !== '([^']+)'/g)].map(m => m[1]!).sort();
}

describe('promptCache.ts, core copy versus runtime copy', () => {
  it('asks the vendor for the same cache type and TTL', () => {
    expect(cacheControlLiteral(runtimeSource)).toBe(cacheControlLiteral(coreSource));
  });

  it('overrides the same chat-model entry points', () => {
    const runtime = overriddenEntryPoints(runtimeSource);

    expect(runtime).toEqual(overriddenEntryPoints(coreSource));
    // Not just equal — equal to the three that matter, so a copy that drops
    // all of them on both sides still fails here.
    expect(runtime).toEqual(['_generate', '_streamChatModelEvents', '_streamResponseChunks']);
  });

  it('accepts the same kill-switch values', () => {
    const runtime = killSwitchOffValues(runtimeSource);

    expect(runtime).toEqual(killSwitchOffValues(coreSource));
    expect(runtime).toEqual(['0', 'false', 'off']);
  });

  it('exports the same caching classes by name', () => {
    const exported = (source: string) => [...source.matchAll(/export class (\w+)/g)].map(m => m[1]!).sort();

    expect(exported(runtimeSource)).toEqual(exported(coreSource));
  });
});
