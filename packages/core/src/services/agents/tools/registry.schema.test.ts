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

function ctx(): RuntimeContext {
  return {
    orgId: 'org_schema_guard',
    userId: 'scheduled',
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs: ['request', 'engineering_task'],
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
