/**
 * Direct-to-HubSpot CATALOG tools — the portal's own vocabulary:
 *
 *   - `hubspot_list_properties`: the live property schema per object type,
 *     including custom properties created minutes ago. The discovery step
 *     before any read or write that names a property.
 *   - `hubspot_list_lists`: the portal's lists (id, name, size, processing
 *     type) — what "the MQL list" actually refers to.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { asJson, clampLimit, hubspotClientForCtx } from './hubspotDirect';

type PropertyRow = {
  name?: string;
  label?: string;
  type?: string;
  fieldType?: string;
  groupName?: string;
  hubspotDefined?: boolean;
  archived?: boolean;
};

export function hubspotListPropertiesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { object_type, name_contains, custom_only } = args as {
        object_type?: 'contacts' | 'companies' | 'deals';
        name_contains?: string;
        custom_only?: boolean;
      };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const obj = object_type ?? 'contacts';
      const res = await resolved.client.get<{ results?: PropertyRow[] }>(`/crm/v3/properties/${obj}`);
      if (!res.ok) {
        return asJson(res);
      }
      const needle = (name_contains ?? '').trim().toLowerCase();
      const properties = (res.data.results ?? [])
        .filter(p => !p.archived && p.name)
        .map(p => ({
          name: p.name!,
          label: p.label ?? p.name!,
          type: p.type ?? null,
          field_type: p.fieldType ?? null,
          group: p.groupName ?? null,
          custom: !p.hubspotDefined,
        }))
        .filter(p => !custom_only || p.custom)
        .filter(p => !needle || p.name.toLowerCase().includes(needle) || p.label.toLowerCase().includes(needle))
        // Custom (team-defined) first, then alphabetical: the custom fields
        // are usually what the caller is hunting for.
        .sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name));
      return asJson({
        ok: true,
        source: 'hubspot_live',
        object_type: obj,
        count: properties.length,
        properties,
      });
    },
    {
      name: 'hubspot_list_properties',
      description: 'Reads HubSpot LIVE, current as of this call: the property SCHEMA for contacts, companies, or deals — every field that exists on records, including custom properties your team created minutes ago. Use it to discover the exact internal property name before reading or writing one, or to check whether a custom field exists. Each row is {name, label, type, field_type, group, custom}; `name` is what the API takes. This lists the schema, not record values: for one record use hubspot_get_contact / hubspot_get_company; for counts use hubspot_count_*.',
      schema: z.object({
        object_type: z.enum(['contacts', 'companies', 'deals']).optional().describe('Which object\'s schema (default contacts).'),
        name_contains: z.string().optional().describe('Case-insensitive filter on the internal name or label, e.g. "revenue".'),
        custom_only: z.boolean().optional().describe('Only team-defined (non-standard) properties.'),
      }),
    },
  );
}

type ListRow = {
  listId?: string | number;
  name?: string;
  processingType?: string;
  objectTypeId?: string;
  updatedAt?: string;
  additionalProperties?: Record<string, unknown>;
};

export function hubspotListListsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { query, limit } = args as { query?: string; limit?: number };
      const resolved = await hubspotClientForCtx(ctx);
      if (!resolved.ok) {
        return asJson(resolved);
      }
      const cap = clampLimit(limit, 20, 250);
      const res = await resolved.client.post<{ lists?: ListRow[]; total?: number }>('/crm/v3/lists/search', {
        count: cap,
        ...(query ? { query } : {}),
      });
      if (!res.ok) {
        return asJson(res);
      }
      const lists = (res.data.lists ?? []).map((row) => {
        const size = Number(row.additionalProperties?.hs_list_size);
        return {
          id: row.listId ?? null,
          name: row.name ?? null,
          size: Number.isFinite(size) ? size : null,
          processing_type: row.processingType ?? null,
          object_type: row.objectTypeId ?? null,
          updated_at: row.updatedAt ?? null,
        };
      });
      return asJson({
        ok: true,
        source: 'hubspot_live',
        count: lists.length,
        ...(typeof res.data.total === 'number' ? { total: res.data.total } : {}),
        query: query ?? null,
        lists,
      });
    },
    {
      name: 'hubspot_list_lists',
      description: 'Reads HubSpot LIVE, current as of this call: the portal\'s LISTS (static and active), each {id, name, size, processing_type, object_type, updated_at}. Use it when someone refers to a list by name ("the MQL list", "the newsletter list") to resolve which list that is and how many records it holds. Optional name filter; default 20 rows, max 250. This reads list definitions, not the records inside them: for counting CRM records by property use hubspot_count_*.',
      schema: z.object({
        query: z.string().optional().describe('Case-insensitive match on list names.'),
        limit: z.number().int().positive().optional().describe('Max lists to return (default 20, max 250).'),
      }),
    },
  );
}

export function hubspotCatalogTools(ctx: RuntimeContext) {
  return [hubspotListPropertiesTool(ctx), hubspotListListsTool(ctx)];
}
