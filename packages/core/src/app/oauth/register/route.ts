import { NextResponse } from 'next/server';
import { OAuthError, registerClient } from '@/services/OAuthService';

/**
 * RFC 7591 dynamic client registration: an assistant introduces itself (backlog 027).
 * @param req
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'The body must be JSON.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await registerClient(body), { status: 201 });
  } catch (e) {
    if (e instanceof OAuthError) {
      return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status });
    }
    throw e;
  }
}
