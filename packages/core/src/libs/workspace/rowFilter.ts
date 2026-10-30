import { z } from 'zod';

/**
 * The row filter grammar a page's stats and filters use (`pageFields.ts`),
 * on its own so an app manifest's home measures (`schemas.ts`) can use the
 * same words without importing the page module, which imports the schemas.
 */

/**
 * `since` keeps the rows whose date field is on or after the start of a
 * window that ends now: `month` (this calendar month), `week` (this week,
 * Monday first), `today`, or `<n>d` (the last n days). UTC throughout, so a
 * stat reads the same from every desk.
 */
export const SinceValueSchema = z.string().regex(/^(month|week|today|\d+d)$/, { message: 'since takes month, week, today or <n>d' });

export const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gte', 'lte', 'in', 'exists', 'missing', 'since', 'contains', 'lacks']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
}).refine(f => (f.op !== 'contains' && f.op !== 'lacks') || (typeof f.value === 'string' && f.value.length > 0), { message: 'contains and lacks take a word', path: ['value'] }).refine(f => f.op !== 'since' || SinceValueSchema.safeParse(f.value).success, { message: 'since takes month, week, today or <n>d', path: ['value'] });

/**
 * `contains` and `lacks` match a word inside a free-text field, ignoring
 * case: a project's stage is written by people and agents ("Closed Lost
 * (pending HubSpot update)"), so an exact `neq` cannot keep closed deals off
 * a list. `lacks` also keeps a row with no value at all.
 */

/** One filter, or every one of several that a row must pass. */
export const WhereSchema = z.union([FilterSchema, z.array(FilterSchema).min(1)]);

export type RowFilter = z.infer<typeof FilterSchema>;
export type RowWhere = z.infer<typeof WhereSchema>;

/**
 * `where: {…}` and `where: [{…}, {…}]` both read as a list of filters.
 * @param where - One filter, several, or none.
 */
export function filtersOf(where: RowWhere | undefined): RowFilter[] {
  return where === undefined ? [] : Array.isArray(where) ? where : [where];
}
