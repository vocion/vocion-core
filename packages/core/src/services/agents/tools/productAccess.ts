/**
 * product_access — a product's production URLs and QA sign-in, for the seats
 * that plan and check against production (QA, the PM). Granted-only
 * (`harness.grantTools: [product_access]`). The password is never returned
 * here: it would sit in the tool_call log. The worker reads it over the API
 * when it signs in (`services/factory/productAccess.ts`).
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { productAccess } from '@/services/factory/productAccess';
import { declareReads } from '../toolReads';

export function productAccessTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes('product_access')) {
    return [];
  }
  // A product's environments and the QA sign-in stored for them.
  return [declareReads(tool(
    async (args) => {
      const access = await productAccess(ctx.orgId, args.product, { stage: args.stage });
      if (access.environments.length === 0) {
        return JSON.stringify({ ok: false, error: `No ${args.stage ?? 'production'} environment is recorded for product "${args.product}". An environment record (type environment) names its product, stage and url.` });
      }
      return JSON.stringify({ ok: true, ...access, note: 'A stored sign-in is used by the worker when it captures production; its password is never shown here.' });
    },
    {
      name: 'product_access',
      description: 'A product\'s environments for one stage (production by default): each one\'s URL and surface, and the QA sign-in stored for it (sign-in page and account email; the password stays with the worker). Use it before planning or judging anything against the live product.',
      schema: z.object({
        product: z.string().describe('The product slug, as requests and releases name it.'),
        stage: z.string().optional().describe('production (default), staging, or another stage an environment records.'),
      }),
    },
  ), { kind: 'product', idArg: 'product' })];
}
