import type { McpConfig } from '../config';
import { z } from 'zod';
import { search as onyxSearch } from '@/libs/onyx/client';
import { getBusinessObject, listBusinessObjects, listObjectTypes } from '@/services/BusinessObjectService';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function dataTools(config: McpConfig): ToolModule[] {
  return [
    objectsListTool(config),
    objectsGetTool(config),
    objectTypesListTool(config),
    searchTool(),
  ];
}

function objectsListTool(config: McpConfig): ToolModule {
  return {
    name: 'objects_list',
    title: 'List business object instances',
    description: 'Return business_object rows for this org. Filter by type slug (e.g. discovery_call, deal).',
    inputSchema: {
      type_slug: z.string().optional(),
      limit: z.number().int().positive().max(200).default(50),
    },
    handler: async (input) => {
      const { type_slug, limit } = input as { type_slug?: string; limit: number };
      const rows = await listBusinessObjects(config.orgId, type_slug);
      return rows.slice(0, limit);
    },
  };
}

function objectsGetTool(config: McpConfig): ToolModule {
  return {
    name: 'objects_get',
    title: 'Get a business object by id',
    description: 'Return a business_object row with its type and document links.',
    inputSchema: { id: z.number().int().positive() },
    handler: async (input) => {
      const { id } = input as { id: number };
      const row = await getBusinessObject(id, config.orgId);
      return row ?? { error: `object ${id} not found` };
    },
  };
}

function objectTypesListTool(config: McpConfig): ToolModule {
  return {
    name: 'object_types_list',
    title: 'List object type definitions',
    description: 'Return the business_object_type rows. Useful for discovering what type slugs are valid for objects_list.',
    inputSchema: {},
    handler: async () => listObjectTypes(config.orgId),
  };
}

function searchTool(): ToolModule {
  return {
    name: 'search_query',
    title: 'Search across connected data sources',
    description: 'Run a retrieval query via Onyx. Returns ranked documents with snippets, source type, dates, and links. Filter by sources (e.g. ["zoom","gmail"]) to narrow scope.',
    inputSchema: {
      q: z.string().describe('the search query in natural language'),
      sources: z.array(z.string()).optional().describe('restrict to these source types'),
      k: z.number().int().positive().max(50).default(10),
    },
    handler: async (input) => {
      const { q, sources, k } = input as { q: string; sources?: string[]; k: number };
      const result = await onyxSearch({
        query: q,
        search_filters: sources ? { source_type: sources } : undefined,
      });
      const topDocuments = (result?.top_documents ?? []) as Array<Record<string, unknown>>;
      const docs = topDocuments.slice(0, k).map(d => ({
        id: d.document_id,
        identifier: d.semantic_identifier,
        source: d.source_type,
        blurb: d.blurb,
        link: d.link,
        score: d.score,
        updatedAt: d.updated_at,
      }));
      return { documents: docs, total: topDocuments.length };
    },
  };
}
