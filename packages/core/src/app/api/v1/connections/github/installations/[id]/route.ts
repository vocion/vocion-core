import { NextResponse } from 'next/server';
import { disconnectInstallation } from '@/services/github/GithubAppService';
import { authApi, isErrorResponse, jsonError, readIdParam, requireCapability } from '../../../../_shared';

/**
 * DELETE /api/v1/connections/github/installations/:id
 *
 * Disconnect: this workspace stops using the installation. It stays
 * installed on GitHub, where another workspace may use it and an owner
 * uninstalls it.
 * Requires the `manage_sources` capability.
 * @param req - The request.
 * @param ctx - Route params.
 * @param ctx.params - `id`, the installation row's id.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'manage_sources');
  if (denied) {
    return denied;
  }
  const id = readIdParam((await ctx.params).id, 'installation');
  if (isErrorResponse(id)) {
    return id;
  }
  if (!(await disconnectInstallation(caller.orgId, id))) {
    return jsonError('NOT_FOUND', `no GitHub installation ${id} in this workspace`, 404);
  }
  return new NextResponse(null, { status: 204 });
}
