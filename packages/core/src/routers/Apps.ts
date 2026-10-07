import { os } from '@orpc/server';
import { appsForUser } from '@/services/AppService';
import { guardAuth } from './AuthGuards';

/**
 * The app rail's data: the apps the signed-in person has in any workspace
 * they can open, and per app the workspaces that have it (each app's
 * workspace picker). See `services/AppService.ts`.
 */
export const forUser = os.handler(async () => {
  const { userId } = await guardAuth();
  return appsForUser(userId);
});
