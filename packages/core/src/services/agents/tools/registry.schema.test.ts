import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * EVERY TOOL'S SCHEMA MUST BE SENDABLE. A tool's zod schema is converted to
 * JSON Schema when it is bound to the model, and that conversion throws on a
 * transform (`preprocess`, `transform`, `coerce`). On 2026-09-25 (#731) one
 * `z.preprocess` on update_object made every turn of every agent with object
 * types fail before the model was called — "Transforms cannot be represented
 * in JSON Schema". This walks the whole registry, strictly, so no tool can
 * ship one again.
 */

vi.mock('@/libs/DB');

const { buildDomainTools } = await import('./registry');
const { filingTypeOf } = await import('./fileRecord');

/** The typed filing tool is generated from a type's schema, so it is walked too. */
const FILING_TYPE = filingTypeOf({
  slug: 'request',
  label: 'Request',
  schema: {
    'type': 'object',
    'x-agent-file': { dedupOn: ['product', 'title'] },
    'properties': {
      title: { type: 'string' },
      product: { 'type': 'string', 'x-display': { to: 'product' } },
      story: { type: 'string' },
      acceptance: { type: 'array', items: { type: 'object', required: ['statement'], properties: { statement: { type: 'string' } } } },
      why: { type: 'array', items: { type: 'string', enum: ['user_request', 'production_bug'] } },
      visuals: { type: 'object', properties: { surfaceUrl: { type: 'string' } } },
      priority: { type: 'integer', minimum: 0, maximum: 100 },
      askedAt: { type: 'string', format: 'date-time' },
      evidence: { type: 'object' },
    },
    'x-gates': [{ name: 'proposal-ready', when: { field: 'status', becomes: ['candidate'] }, producedBy: 'product-manager', require: [{ field: 'story', present: true }, { field: 'acceptance', minItems: 3 }, { field: 'visuals.surfaceUrl', present: true }] }],
  },
}, { product: ['ledger', 'send'] })!;

function ctx(): RuntimeContext {
  return {
    orgId: 'org_schema_guard',
    userId: 'scheduled',
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: ['request', 'engineering_task'],
    filingTypes: [FILING_TYPE],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: () => {},
  } as unknown as RuntimeContext;
}

describe('every agent tool can be bound to a model', () => {
  it('converts to JSON Schema with no transform in it', () => {
    const tools = buildDomainTools(ctx());

    expect(tools.map(t => t.name)).toContain('update_object');
    expect(tools.map(t => t.name)).toContain('file_request');

    const unsendable: string[] = [];
    for (const t of tools) {
      if (!(t.schema instanceof z.ZodType)) {
        continue;
      }
      try {
        // The converter the model binding itself uses — zod's own accepts a
        // preprocess in input mode, which is how #731 slipped through.
        toJsonSchema(t.schema as never);
      } catch (err) {
        unsendable.push(`${t.name}: ${(err as Error).message}`);
      }
    }

    expect(unsendable).toEqual([]);
  });
});
