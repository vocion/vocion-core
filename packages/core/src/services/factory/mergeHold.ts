/**
 * A PRODUCT'S MERGES WAIT FOR A PERSON (Chris, 2026-10-05: "for that Project we need a HARD STOP
 * waiting for human approval before anything goes to main or production"). The product record
 * says so (`mergeApproval: person`); the merge of any change to it is then a card for a person,
 * whatever the workspace's trust rules say, and the feature page says the merge waits for them.
 *
 * Read from the merge's input: the task it closes, the task's request, the request's product, the
 * product record by its slug. A merge that names no task holds only when it names the product.
 */

type Meta = Record<string, unknown>;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The product slug a merge is for: its own `productSlug`, else its task's, else the task's request's.
 * @param orgId - The workspace.
 * @param input - The merge's input.
 */
export async function mergeProductSlug(orgId: string, input: Meta): Promise<string | null> {
  const named = text(input.productSlug);
  if (named) {
    return named;
  }
  const taskId = Number(input.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return null;
  }
  const { db } = await import('@/libs/DB');
  const { and, eq } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const meta = async (id: number): Promise<Meta | null> => {
    const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id))).limit(1);
    return (row?.meta ?? null) as Meta | null;
  };
  const task = await meta(taskId);
  const fromTask = text(task?.productSlug) ?? text(task?.product);
  if (fromTask) {
    return fromTask;
  }
  const requestId = Number(task?.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return null;
  }
  const request = await meta(requestId);
  return text(request?.product);
}

/**
 * Why this merge waits for a person, or null. Reads the product record the merge is for.
 * @param orgId - The workspace.
 * @param input - The merge's input.
 */
export async function productMergeHold(orgId: string, input: Meta): Promise<string | null> {
  const slug = await mergeProductSlug(orgId, input);
  if (!slug) {
    return null;
  }
  const { db } = await import('@/libs/DB');
  const { and, eq, sql } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [product] = await db.select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata}->>'slug' = ${slug}`, sql`${businessObjectSchema.metadata} ? 'mergeApproval'`)).limit(1);
  const rule = text((product?.meta as Meta | undefined)?.mergeApproval);
  return rule === 'person'
    ? `${text((product?.meta as Meta).name) ?? product!.title} merges only when a person approves: nothing reaches main or production without one.`
    : null;
}
