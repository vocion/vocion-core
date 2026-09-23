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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentEvent, InvocationRequest } from './contract.js';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import process from 'node:process';
import { runInvocation } from './loop.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

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

/**
 * Abort the turn when the response closed before the turn finished writing
 * it — the caller hung up. A response that ended normally closes too, and
 * aborts nothing.
 * @param res - The event-stream response.
 * @param callerLeft - The turn's abort controller.
 */
export function abortWhenCallerLeft(res: ServerResponse, callerLeft: AbortController): void {
  if (!res.writableEnded) {
    callerLeft.abort(new Error('the caller closed the connection'));
  }
}

/**
 * Write to the event stream unless the caller has already gone; a write to a
 * destroyed response only raises an error nobody is listening for.
 * @param res - The event-stream response.
 * @param chunk - The frame to write.
 */
export function writeWhileOpen(res: ServerResponse, chunk: string): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.write(chunk);
}

async function handleInvocation(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  // The caller hanging up ends the turn: vocion-core drops the connection to
  // stop a turn that reached its budget (#272), and nothing charges a model
  // call made after that.
  const callerLeft = new AbortController();
  res.on('close', () => abortWhenCallerLeft(res, callerLeft));

  const send = (event: AgentEvent): void => writeWhileOpen(res, `data: ${JSON.stringify(event)}\n\n`);

  // 15s keepalives — same cadence as core's SSE route; comment frames
  // are ignored by EventSource-style parsers.
  const keepalive = setInterval(() => writeWhileOpen(res, ': keepalive\n\n'), 15_000);

  try {
    await runInvocation(invocation, send, callerLeft.signal);
  } catch (err) {
    // runInvocation already emitted an `error` event; this catch only
    // guards the stream teardown.
    console.error(`invocation failed: ${(err as Error).message}`);
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}

export function startServer(port: number): void {
  const server = createServer((req, res) => {
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

  server.listen(port, () => {
    console.warn(`vocion agent-runtime listening on :${port} (/invocations, /ping)`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}
