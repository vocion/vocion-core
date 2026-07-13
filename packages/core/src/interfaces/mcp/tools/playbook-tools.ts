import type { McpConfig } from '../config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { playbookSchema } from '@/models/Schema';

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
    description: 'Return the catalog of playbooks for this org (slug, name, description, tags, version, license).',
    inputSchema: {
      tag: z.string().optional().describe('filter to playbooks with this tag'),
    },
    handler: async (input) => {
      const { tag } = input as { tag?: string };
      const rows = await db
        .select({
          slug: playbookSchema.slug,
          name: playbookSchema.name,
          description: playbookSchema.description,
          tags: playbookSchema.tags,
          version: playbookSchema.version,
          license: playbookSchema.license,
          sourceFiles: playbookSchema.sourceFiles,
        })
        .from(playbookSchema)
        .where(eq(playbookSchema.orgId, config.orgId));
      return tag ? rows.filter(r => (r.tags ?? []).includes(tag)) : rows;
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
      const contextPath = getWorkspacePath();
      if (!contextPath) {
        throw new Error('WORKSPACE_PATH is not set — playbook files unavailable');
      }
      const folder = join(process.cwd(), contextPath, 'playbooks', slug);
      const target = resource ? join(folder, resource) : join(folder, 'SKILL.md');
      const content = readFileSync(target, 'utf8');
      return {
        slug: row.slug,
        name: row.name,
        description: row.description,
        tags: row.tags,
        version: row.version,
        license: row.license,
        sourceFiles: row.sourceFiles,
        resource: resource ?? 'SKILL.md',
        content,
      };
    },
  };
}
