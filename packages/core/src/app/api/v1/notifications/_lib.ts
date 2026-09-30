import type { NextResponse as NextResponseType } from 'next/server';
import type { ApiCaller } from '@/services/writeApi';
import { NO_PERSON, personOf } from '@/services/notifications/person';
import { jsonError } from '../_shared';

/**
 * Name the PERSON an authenticated call is about — notifications, settings
 * and devices are a person's (`services/notifications/person.ts`). A 403
 * saying why when the credential names nobody.
 * @param caller - From `authApi`.
 */
export async function personFor(caller: ApiCaller): Promise<{ orgId: string; userId: string } | NextResponseType> {
  const userId = await personOf(caller);
  if (!userId) {
    return jsonError('FORBIDDEN', NO_PERSON, 403);
  }
  return { orgId: caller.orgId, userId };
}
