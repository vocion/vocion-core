import { NextResponse } from 'next/server';
import { auth } from '@/libs/Auth';
import { approveRequest, denyRequest, OAuthError } from '@/services/OAuthService';

/**
 * The consent page's form lands here: the signed-in person approves (or
 * declines) the assistant for their ACTIVE workspace, and is sent back to
 * the assistant with the code (backlog 027).
 * @param req
 */
export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.projectId) {
    return NextResponse.json({ error: 'access_denied', error_description: 'Sign in and pick a workspace first.' }, { status: 401 });
  }
  const form = await req.formData();
  const id = String(form.get('request') ?? '');
  const decision = String(form.get('decision') ?? 'approve');
  try {
    if (decision === 'deny') {
      const denied = await denyRequest(id);
      return denied ? NextResponse.redirect(denied.redirectTo, 303) : NextResponse.json({ error: 'invalid_request' }, { status: 410 });
    }
    const approved = await approveRequest({ id, userId: user.id, orgId: user.projectId });
    return NextResponse.redirect(approved.redirectTo, 303);
  } catch (e) {
    if (e instanceof OAuthError) {
      return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status });
    }
    throw e;
  }
}
