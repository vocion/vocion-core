import type { CodeProvider } from './types';
import process from 'node:process';

/**
 * E2B sandbox provider — runs arbitrary code (Python/JS) in an isolated
 * cloud sandbox. Opt-in via VOCION_CODE_PROVIDER=e2b + E2B_API_KEY.
 *
 * Registered as a declared-but-unbuilt provider (mirrors the
 * vertex/azure LLM placeholders): the integration ships with the E2B
 * SDK when a tenant needs real sandboxed execution. Until then the
 * builtin calculator is the safe default.
 */
export function e2bCodeProvider(): CodeProvider {
  return {
    name: 'e2b',
    requiredEnv: ['E2B_API_KEY'],
    isReady: () => Boolean(process.env.E2B_API_KEY),
    kind: 'sandbox',
    async run() {
      throw new Error('e2b sandboxed code execution is not yet wired — use VOCION_CODE_PROVIDER=builtin (calculator) for now');
    },
  };
}
