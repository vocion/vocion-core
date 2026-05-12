import { auth } from '@clerk/nextjs/server';
import { langfuse, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';

const ONYX_URL = process.env.ONYX_API_URL || 'http://localhost:8080';
const ONYX_KEY = process.env.ONYX_API_KEY || '';

export async function POST(request: Request) {
  if (!ONYX_KEY) {
    return new Response(JSON.stringify({ error: 'Onyx API key not configured' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { orgId, userId } = await auth();

  const body = await request.json();
  const message = body.message as string;
  const sessionId = body.chat_session_id as string | undefined;

  // Start Langfuse trace for this chat request
  const trace = traceFor({
    feature: FEATURES.ONYX_SEARCH,
    slug: 'live',
    orgId: orgId ?? 'anonymous',
    userId: userId ?? 'system',
    input: { message },
    sessionId: sessionId ?? undefined,
    metadata: {
      source: 'corecontext-chat',
    },
  });

  const span = trace.span({
    name: 'onyx-chat',
    input: { message, chat_session_id: sessionId },
  });

  const startTime = Date.now();

  const res = await fetch(`${ONYX_URL}/chat/send-chat-message`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ONYX_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      chat_session_id: sessionId || undefined,
      stream: true,
      include_citations: true,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    span.end({ output: { error: text }, level: 'ERROR' });
    trace.update({ output: { error: text } });
    await langfuse.flushAsync();
    return new Response(JSON.stringify({ error: text }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Tee the stream so we can read it for Langfuse while passing it to the client
  const [clientStream, traceStream] = res.body.tee();

  // Read the trace stream in the background to capture the full response
  const captureResponse = async () => {
    const reader = traceStream.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let documentCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;

        // Count documents from search results
        if (chunk.includes('search_tool_documents')) {
          const matches = chunk.match(/"document_id"/g);
          if (matches) {
            documentCount += matches.length;
          }
        }
      }
    } catch {
      // Stream read error — non-fatal for tracing
    }

    const elapsed = Date.now() - startTime;

    span.end({
      output: {
        response_length: fullResponse.length,
        document_count: documentCount,
        elapsed_ms: elapsed,
      },
    });

    trace.update({
      output: {
        response_length: fullResponse.length,
        document_count: documentCount,
      },
      metadata: {
        elapsed_ms: elapsed,
        source: 'corecontext-chat',
      },
    });

    await langfuse.flushAsync();
  };

  // Fire and forget — don't block the response
  captureResponse().catch(() => {});

  return new Response(clientStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
