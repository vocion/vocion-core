/**
 * Reading a database error without depending on who wrapped it.
 *
 * Postgres reports a unique-constraint violation as SQLSTATE 23505 and names
 * the index it hit in `constraint`. Drizzle wraps the driver's error in one of
 * its own carrying the failed query, so both fields sit on `cause` — checked on
 * the error and on its cause, because the wrapping is drizzle's business and
 * not something to depend on.
 */

/**
 * Whether a database error is a unique-constraint violation, optionally of one
 * named index.
 * @param error - Whatever the query threw.
 * @param constraint - The index or constraint name to match; any when omitted.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (stringField(candidate, 'code') === '23505'
      && (constraint === undefined || stringField(candidate, 'constraint') === constraint)) {
      return true;
    }
  }
  return false;
}

/**
 * A string-valued field of an error-shaped object, or undefined for anything
 * else.
 * @param error - A candidate error object.
 * @param field - The field to read.
 */
function stringField(error: unknown, field: 'code' | 'constraint'): string | undefined {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}
