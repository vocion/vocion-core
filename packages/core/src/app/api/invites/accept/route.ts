import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/libs/Auth';
import { acceptInviteAsExistingUser } from '@/services/InviteAcceptance';

const bodySchema = z.object({ inviteToken: z.string().min(1) });

/**
 * `POST /api/invites/accept` — a signed-in person joins the invite's account
 * on the login they already have (vocion-core#128).
 *
 * `/api/signup` is for someone with no login yet and creates their user; this
 * is for everyone else, and adds one membership to the user they are signed
 * in as. The invite must be addressed to that user's email. Answers with
 * `openPath`, the first workspace on the joined account, for the page to go
 * to next, or null when they can open none there yet.
 * @param req - `{ inviteToken }` as JSON.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Sign in to accept this invite.' }, { status: 401 });
  }
  // JSON only: a cross-site HTML form can send text/plain without a CORS
  // preflight, and would otherwise be read here all the same.
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send the invite token as `inviteToken`.' }, { status: 400 });
  }
  const result = await acceptInviteAsExistingUser(userId, parsed.data.inviteToken);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, openPath: result.openPath });
}
