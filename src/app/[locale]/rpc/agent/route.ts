import type { AgentEvent } from '@/services/AgentService';
import { auth } from '@clerk/nextjs/server';
import { runAgent } from '@/services/AgentService';

export async function POST(request: Request) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await request.json();
  const message = body.message as string;
  const agentSlug = (body.agent_slug as string) || 'ziggy';
  const stream = body.stream !== false; // default true

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });
  }

  if (!stream) {
    // Non-streaming mode (backward compat)
    try {
      const result = await runAgent({ orgId, agentSlug, message, userId });
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
