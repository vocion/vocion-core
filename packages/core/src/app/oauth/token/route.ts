import { NextResponse } from 'next/server';
import { exchangeCode, OAuthError } from '@/services/OAuthService';

/**
 * The code and its PKCE verifier become a Vocion API token (backlog 027). Form or JSON, as clients differ.
 * @param req
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  const type = req.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      body = Object.fromEntries(new URLSearchParams(await req.text()).entries());
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request', error_description: 'The body could not be read.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await exchangeCode(body), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof OAuthError) {
      return NextResponse.json({ error: e.code, error_description: e.message }, { status: e.status });
    }
    throw e;
  }
}
