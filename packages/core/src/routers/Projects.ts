import { os } from '@orpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema } from '@/models/Schema';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const list = os.handler(async () => {
  const { userId } = await guardAuth();
  const [membership] = await db
    .select({ accountId: accountMembershipSchema.accountId })
    .from(accountMembershipSchema)
    .where(eq(accountMembershipSchema.userId, userId))
    .limit(1);
  if (!membership) {
    return { projects: [] };
  }
  const projects = await db
    .select({
      id: projectSchema.id,
      slug: projectSchema.slug,
      name: projectSchema.name,
      description: projectSchema.description,
    })
    .from(projectSchema)
    .where(eq(projectSchema.accountId, membership.accountId));
  return { projects };
});

export const setActive = os
  .input(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { userId } = await guardAuth();
    const [membership] = await db
      .select({ accountId: accountMembershipSchema.accountId })
      .from(accountMembershipSchema)
      .where(eq(accountMembershipSchema.userId, userId))
      .limit(1);
    if (!membership) {
      throw ApiError.forbidden();
    }
    const [proj] = await db
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(and(eq(projectSchema.id, input.projectId), eq(projectSchema.accountId, membership.accountId)))
      .limit(1);
    if (!proj) {
      throw ApiError.notFound();
    }
    // Note: cookie is set client-side (see ProjectSwitcher). oRPC's fetch
    // response bypasses Next's cookie-writing machinery so cookies().set()
    // here would be silently dropped.
    return { ok: true, projectId: proj.id };
  });
