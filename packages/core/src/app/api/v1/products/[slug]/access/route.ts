import { NextResponse } from 'next/server';
import { productAccess } from '@/services/factory/productAccess';
import { authApi, isErrorResponse, requireCapability } from '../../../_shared';

/**
 * GET /api/v1/products/:slug/access — a product's production environments and
 * QA sign-in. `?reveal=1` includes the password, for the worker signing in to
 * capture live evidence; it needs the `reveal_app_login` capability (or `*`).
 * `?stage=` reads another stage.
 * @param req - The request.
 * @param ctx - The route params.
 * @param ctx.params - `{ slug }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const reveal = url.searchParams.get('reveal') === '1';
  if (reveal) {
    const denied = requireCapability(caller, 'reveal_app_login');
    if (denied) {
      return denied;
    }
  }
  const access = await productAccess(caller.orgId, slug, { reveal, stage: url.searchParams.get('stage') ?? undefined });
  return NextResponse.json(access);
}
