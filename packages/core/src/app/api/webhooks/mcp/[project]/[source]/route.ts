import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/libs/Logger';
import { mcpCredentialsOf } from '@/libs/outboundMcp/client';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { readUpdatesNow, verifyUpdatesPing } from '@/services/outboundMcp/updatesPing';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/**
 * POST /api/webhooks/mcp/<project>/<source> — a connected system says it has something for a
 * conversation that asked it for work (`services/outboundMcp/updatesPing.ts`). Signed with the
 * source's own token; the body is not read. A good ping makes the workspace read that source's
 * updates now and say each one where it was asked (`mcp-updates`). Answered at once.
 * @param request - The ping.
 * @param ctx - The route.
 * @param ctx.params - The workspace and the source.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ project: string; source: string }> }) {
  const { project, source: slug } = await ctx.params;
  const body = await request.text();
  // One answer for every way it can be wrong, so the address tells a stranger nothing.
  const refuse = (reason: string) => {
    logger.warn('mcp updates ping refused', { orgId: project, sourceSlug: slug, reason });
    return NextResponse.json({ error: 'not accepted' }, { status: 401 });
  };
  try {
    const [source] = await loadMcpSources(project, [slug]);
    if (!source?.config.updatesTool || source.config.auth !== 'token') {
      return refuse('no such source');
    }
    const { token } = mcpCredentialsOf(await getCredentialsForSource(project, slug, 'any'));
    const verified = verifyUpdatesPing({ token, timestamp: request.headers.get('x-updates-timestamp'), signature: request.headers.get('x-updates-signature'), body });
    if (!verified.ok) {
      return refuse(verified.reason);
    }
    const state = await readUpdatesNow(project, slug, async () => (await import('@/services/jobs/mcpUpdates')).runMcpUpdatesJob(project, { source: slug }));
    return NextResponse.json({ ok: true, read: state }, { status: 202 });
  } catch {
    return refuse('not connected');
  }
}
