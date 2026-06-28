import type { CodeProvider } from './types';
import { calculate } from './calculator';

/**
 * Builtin code provider — a safe, network-free calculator. Evaluates math
 * expressions only (no arbitrary code). For full sandboxed code execution
 * set VOCION_CODE_PROVIDER=e2b.
 */
export function builtinCodeProvider(): CodeProvider {
  return {
    name: 'builtin',
    requiredEnv: [],
    isReady: () => true,
    kind: 'calculator',
    async run(code) {
      const value = calculate(code);
      return { output: String(value) };
    },
  };
}
