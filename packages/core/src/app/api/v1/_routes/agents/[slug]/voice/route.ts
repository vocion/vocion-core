import { NextResponse } from 'next/server';
import { AgentVoiceError, getAgentVoice, setAgentVoice } from '@/services/agents/agentVoice';
import { authApi, isErrorResponse, jsonError, readJsonBody, requireCapability } from '../../../_shared';

/**
 * GET /api/v1/agents/:slug/voice — how the agent talks in chat: the voice it
 * runs with, what its workspace YAML says, and what a person set over it.
 *
 * PUT /api/v1/agents/:slug/voice — set it. Body: any of `length` (brief |
 * standard | detailed), `narration` (off | on), `creativity` (0–1), `style`
 * (a wiki page slug); a key sent as null clears it back to the YAML, and
 * `{ "clear": true }` clears them all. Same service as the agent's page, MCP
 * (`agent_voice_set`) and chat (`set_voice`). Needs the approve capability.
 * @param req - Request.
 * @param context - Route params.
 * @param context.params
 */
export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const { slug } = await context.params;
  try {
    return NextResponse.json(await getAgentVoice(caller.orgId, slug));
  } catch (e) {
    return voiceError(e);
  }
}

export async function PUT(req: Request, context: { params: Promise<{ slug: string }> }) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireCapability(caller, 'approve');
  if (denied) {
    return denied;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const { slug } = await context.params;
  const { clear, ...change } = body as Record<string, unknown>;
  try {
    return NextResponse.json(await setAgentVoice(caller.orgId, slug, change as never, { clear: clear === true }));
  } catch (e) {
    return voiceError(e);
  }
}

function voiceError(e: unknown) {
  if (e instanceof AgentVoiceError) {
    return jsonError(e.code, e.message, e.code === 'NOT_FOUND' ? 404 : 400);
  }
  throw e;
}
