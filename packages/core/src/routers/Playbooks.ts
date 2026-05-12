import { os } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { playbookSchema } from '@/models/Schema';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Playbook oRPC router (v0.2). Read-only catalog endpoints.
 * Authoring happens via context/<org>/playbooks/<slug>/SKILL.md +
 * `context:apply` — developer-first positioning means no write API.
 */

export const list = os
  .handler(async () => {
    const { orgId } = await guardAuth();
    return db
      .select({
        id: playbookSchema.id,
        slug: playbookSchema.slug,
        name: playbookSchema.name,
        description: playbookSchema.description,
        tags: playbookSchema.tags,
        version: playbookSchema.version,
        license: playbookSchema.license,
        sourceFiles: playbookSchema.sourceFiles,
        updatedAt: playbookSchema.updatedAt,
      })
      .from(playbookSchema)
      .where(eq(playbookSchema.orgId, orgId));
  });

export const get = os
  .input(z.object({ slug: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const [row] = await db
      .select()
      .from(playbookSchema)
      .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, input.slug)));
    if (!row) {
      throw ApiError.notFound({ slug: input.slug });
    }
    return row;
  });
