/**
 * run_code — evaluate a calculation (builtin calculator) or run code in a
 * sandbox (E2B, opt-in). Provider via VOCION_CODE_PROVIDER.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getCodeProvider } from '@/libs/tools/code/registry';

export function runCodeTool(_ctx: RuntimeContext) {
  const provider = getCodeProvider();
  const isCalc = provider.kind === 'calculator';
  return tool(
    async (args) => {
      try {
        const { code } = args;
        const { output } = await provider.run(code, { language: args.language });
        return `Result: ${output}`;
      } catch (err) {
        return `${isCalc ? 'Calculation' : 'Code'} error: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'run_code',
      description: isCalc
        ? 'Evaluate a math expression precisely (e.g. "1234*0.0825", "round(sqrt(2)*100)/100"). Supports + - * / % ^, parentheses, and functions like sqrt/log/min/max/round plus constants pi and e. Use this instead of doing arithmetic in your head.'
        : 'Run code in an isolated sandbox and return its output. Provide the code and (optionally) the language.',
      schema: z.object({
        code: z.string().min(1).describe(isCalc ? 'A math expression to evaluate' : 'The code to run'),
        language: z.string().optional().describe('Language (sandbox only), e.g. python or javascript'),
      }),
    },
  );
}
