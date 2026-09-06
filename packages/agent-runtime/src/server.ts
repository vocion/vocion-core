/**
 * The BYOA HTTP contract: POST /invocations + GET /ping.
 *
 * This is the shape AWS Bedrock AgentCore Runtime expects from a hosted
 * agent (port 8080), and it is exactly what runs on a laptop — same
 * artifact, different host. Responses stream as Server-Sent Events, one
 * `AgentEvent` JSON object per `data:` line, so the vocion-core provider
 * can relay them 1:1 into the chat UI's existing stream.
 *
 * Deliberately dependency-free (node:http): the fewer moving parts in
 * the bundle, the fewer CodeZip surprises on the managed runtime.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AgentEvent, InvocationRequest } from './contract.js';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import process from 'node:process';
import { runInvocation } from './loop.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * AgentCore authenticates InvokeAgentRuntime with SigV4 before the request
 * reaches this process. Local HTTP has no such boundary, so it must use a
 * separately configured bearer secret and fail closed when it is missing.
 * @param req - Incoming request whose bearer credentials should be checked.
 */
function isAuthorized(req: IncomingMessage): boolean {
  const authMode = process.env.VOCION_AGENT_RUNTIME_AUTH_MODE ?? 'secret';
  if (authMode === 'agentcore') {
    return true;
  }
  if (authMode !== 'secret') {
    console.error(`agent runtime rejected unsupported auth mode: ${authMode}`);
    return false;
  }

  const expectedSecret = process.env.VOCION_AGENT_RUNTIME_SECRET;
  const authorization = req.headers.authorization;
  const prefix = 'Bearer ';
  const providedSecret = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : undefined;
  if (!expectedSecret || !providedSecret) {
    return false;
  }

  const expected = Buffer.from(expectedSecret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validate(body: unknown): InvocationRequest {
  const r = body as Partial<InvocationRequest>;
  if (!r || typeof r !== 'object') {
    throw new Error('body must be a JSON object');
  }
  if (!r.agent?.slug || typeof r.agent.systemPrompt !== 'string') {
    throw new Error('agent.slug and agent.systemPrompt are required');
  }
  if (typeof r.message !== 'string' || r.message.length === 0) {
    throw new Error('message is required');
  }
  if (!r.tools || typeof r.tools.endpoint !== 'string' || typeof r.tools.claim !== 'string' || !Array.isArray(r.tools.catalog)) {
    throw new Error('tools.endpoint, tools.claim and tools.catalog are required');
  }
  return r as InvocationRequest;
}

async function handleInvocation(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    console.warn('agent runtime invocation rejected: invalid authentication');
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer',
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  let invocation: InvocationRequest;
  try {
    invocation = validate(JSON.parse(await readBody(req)));
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  });

  const send = (event: AgentEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // 15s keepalives — same cadence as core's SSE route; comment frames
  // are ignored by EventSource-style parsers.
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);

  try {
    await runInvocation(invocation, send);
  } catch (err) {
    // runInvocation already emitted an `error` event; this catch only
    // guards the stream teardown.
    console.error(`invocation failed: ${(err as Error).message}`);
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}

export function createRuntimeServer(): Server {
  return createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'Healthy' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/invocations') {
      void handleInvocation(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

export function startServer(port: number): void {
  const server = createRuntimeServer();

  server.listen(port, () => {
    console.warn(`vocion agent-runtime listening on :${port} (/invocations, /ping)`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}
