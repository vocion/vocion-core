/**
 * POST /api/internal/agent-tools — the tool endpoint for the BYOA
 * agent runtime. Auth is the signed TenantClaim (Bearer), not a user
 * session: the runtime artifact is the only intended caller. All
 * tenancy enforcement lives in `executeToolCall`; this route is a thin
 * HTTP shell.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { executeToolCall } from '@/services/agents/toolEndpoint';

export async function POST(request: NextRequest) {
  const authz = request.headers.get('authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length) : '';
  if (!token) {
    return NextResponse.json({ error: 'missing claim' }, { status: 401 });
  }

  let body: { tool?: string; input?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.tool || typeof body.tool !== 'string') {
    return NextResponse.json({ error: 'tool is required' }, { status: 400 });
  }

  const result = await executeToolCall({
    token,
    tool: body.tool,
    input: body.input ?? {},
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ output: result.output, events: result.events });
}
