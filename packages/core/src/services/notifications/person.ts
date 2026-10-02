import type { ApiCaller } from '@/services/writeApi';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { apiTokenSchema, userSchema } from '@/models/Schema';

/**
 * Notifications, settings and devices belong to a PERSON, so every surface
 * that reads them (API, MCP) has to name one. A dashboard session is its
 * person. A tenant token is the person who minted it — an OAuth assistant's
 * token included, which is minted for the person who consented — so "my
 * notifications" over the API means the token owner's. A caller that names
 * nobody (a system token with no creator, the stdio MCP plane) gets null and
 * a sentence saying why.
 * @param caller - The authenticated caller.
 */
export async function personOf(caller: Pick<ApiCaller, 'actorId' | 'source'>): Promise<string | null> {
  if (caller.source === 'session') {
    return caller.actorId;
  }
  const tokenId = caller.actorId.startsWith('token:') ? caller.actorId.slice('token:'.length) : null;
  if (!tokenId) {
    return null;
  }
  const [row] = await db
    .select({ userId: userSchema.id })
    .from(apiTokenSchema)
    .innerJoin(userSchema, eq(userSchema.id, apiTokenSchema.createdBy))
    .where(eq(apiTokenSchema.id, tokenId))
    .limit(1);
  return row?.userId ?? null;
}

export const NO_PERSON = 'Notifications belong to a person, and this credential names none: sign in, or use a token a person minted.';
