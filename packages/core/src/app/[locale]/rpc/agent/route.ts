import type { AgentEvent } from '@/services/AgentService';
import { clerkAuth as auth } from '@/libs/Auth';
import { listAgents, runAgent } from '@/services/AgentService';

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const message = body.message as string;
  // Resolve the agent. Explicit `agent_slug` wins; otherwise fall back to
  // the first agent authored for this project. No project agents → 404
  // (the pre-v0.5.2 hardcoded "sales-assistant" fallback is gone).
  let agentSlug = body.agent_slug as string | undefined;
  if (!agentSlug) {
    const agents = await listAgents(orgId);
    if (agents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No agents authored for this project. See /dashboard/chat for setup.' }),
        { status: 404 },
      );
    }
    agentSlug = agents[0]!.slug;
  }
  const stream = body.stream !== false; // default true
  const conversationHistory = (body.conversation_history as Array<{ role: string; content: string }>) ?? [];

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });
  }

  if (!stream) {
    // Non-streaming mode (backward compat)
    try {
      const result = await runAgent({ orgId, agentSlug, message, userId, conversationHistory: conversationHistory as any[] });
      return new Response(JSON.stringify({
        response: result.response,
        trace_id: result.traceId,
        tool_calls: result.toolCalls.map(tc => ({ tool: tc.tool, input: tc.input })),
      }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message ?? 'Agent error' }), { status: 500 });
    }
  }

  // Streaming mode: emit events as they happen
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // stream closed
        }
      };

      try {
        const result = await runAgent({
          orgId,
          agentSlug,
          message,
          userId,
          conversationHistory: conversationHistory as any[],
          onEvent: send,
        });

        send({
          type: 'done',
          response: result.response,
          traceId: result.traceId,
          toolCalls: result.toolCalls.map(tc => ({ tool: tc.tool, input: tc.input })),
        });
      } catch (err: any) {
        send({ type: 'error', output: err.message ?? 'Agent error' });
      }

      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
