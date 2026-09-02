import type { McpConfig } from '../config';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { playbookSchema } from '@/models/Schema';
import { readByOrigin } from '@/services/playbooks/mount';

/**
 * Playbook MCP tools — let an external MCP client (Claude Code, etc.)
 * browse the catalog and read playbook bodies. Read-only; authoring
 * stays in `workspace/<org>/playbooks/` + `workspace:apply`.
 */

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function playbookTools(config: McpConfig): ToolModule[] {
  return [playbookListTool(config), playbookGetTool(config)];
}

function playbookListTool(config: McpConfig): ToolModule {
  return {
    name: 'playbook_list',
    title: 'List playbooks',
    description: 'Return the catalog of skills and playbooks for this org (slug, name, description, kind, origin, version, license).',
    inputSchema: {
      kind: z.enum(['skill', 'playbook']).optional().describe('filter to one kind'),
    },
    handler: async (input) => {
      const { kind } = input as { kind?: 'skill' | 'playbook' };
      const rows = await db
        .select({
          slug: playbookSchema.slug,
          name: playbookSchema.name,
          description: playbookSchema.description,
          kind: playbookSchema.kind,
          origin: playbookSchema.origin,
          attachedPlaybooks: playbookSchema.attachedPlaybooks,
          version: playbookSchema.version,
          license: playbookSchema.license,
          sourceFiles: playbookSchema.sourceFiles,
        })
        .from(playbookSchema)
        .where(eq(playbookSchema.orgId, config.orgId));
      return kind ? rows.filter(r => r.kind === kind) : rows;
    },
  };
}

function playbookGetTool(config: McpConfig): ToolModule {
  return {
    name: 'playbook_get',
    title: 'Read a playbook body',
    description: 'Return a playbook\'s SKILL.md body and optionally one named sibling resource (REFERENCE.html, etc.). Resources are listed on the catalog row.',
    inputSchema: {
      slug: z.string(),
      resource: z.string().optional().describe('relative path of a sibling resource (e.g. REFERENCE.html). Returns body when omitted.'),
    },
    handler: async (input) => {
      const { slug, resource } = input as { slug: string; resource?: string };
      const [row] = await db
        .select()
        .from(playbookSchema)
        .where(and(eq(playbookSchema.orgId, config.orgId), eq(playbookSchema.slug, slug)));
      if (!row) {
        throw new Error(`playbook ${slug} not found`);
      }
      const content = readByOrigin(row, resource ?? 'SKILL.md');
      if (content === null) {
        throw new Error(`file ${resource ?? 'SKILL.md'} for ${row.kind} ${slug} not found on disk`);
      }
      return {
        slug: row.slug,
        name: row.name,
        description: row.description,
        kind: row.kind,
        origin: row.origin,
        version: row.version,
        license: row.license,
        sourceFiles: row.sourceFiles,
        resource: resource ?? 'SKILL.md',
        content,
      };
    },
  };
}
