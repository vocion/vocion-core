import type { AddressInfo } from 'node:net';
import type { InvocationRequest } from './contract.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./loop.js', () => ({ runInvocation: vi.fn() }));

const { runInvocation: runInvocationImpl } = await import('./loop.js');
const { createRuntimeServer } = await import('./server.js');
const runInvocation = vi.mocked(runInvocationImpl);

const invocation: InvocationRequest = {
  version: 1,
  agent: { slug: 'test-agent', name: 'Test Agent', systemPrompt: 'Be helpful.' },
  message: 'hello',
  tools: { endpoint: 'http://localhost/tools', catalog: [], claim: 'claim' },
};

const originalAuthMode = process.env.VOCION_AGENT_RUNTIME_AUTH_MODE;
const originalSecret = process.env.VOCION_AGENT_RUNTIME_SECRET;
let server: ReturnType<typeof createRuntimeServer>;
let port: number;

async function listen(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP address');
  }
  port = (address as AddressInfo).port;
}

async function post(headers?: Record<string, string>, body = JSON.stringify(invocation)): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

beforeEach(async () => {
  process.env.VOCION_AGENT_RUNTIME_AUTH_MODE = 'secret';
  process.env.VOCION_AGENT_RUNTIME_SECRET = 'runtime-test-secret';
  runInvocation.mockReset();
  runInvocation.mockImplementation(async (_request, send) => {
    send({ type: 'done', response: 'ok' });
  });
  server = createRuntimeServer();
  await listen();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  vi.restoreAllMocks();
  if (originalAuthMode === undefined) {
    delete process.env.VOCION_AGENT_RUNTIME_AUTH_MODE;
  } else {
    process.env.VOCION_AGENT_RUNTIME_AUTH_MODE = originalAuthMode;
  }
  if (originalSecret === undefined) {
    delete process.env.VOCION_AGENT_RUNTIME_SECRET;
  } else {
    process.env.VOCION_AGENT_RUNTIME_SECRET = originalSecret;
  }
});

describe('POST /invocations authentication', () => {
  it('rejects an unauthenticated request before parsing or model work, and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await post(undefined, 'not-json');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(runInvocation).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('agent runtime invocation rejected: invalid authentication');
  });

  it('rejects an incorrect bearer secret', async () => {
    const response = await post({ authorization: 'Bearer wrong-secret' });

    expect(response.status).toBe(401);
    expect(runInvocation).not.toHaveBeenCalled();
  });

  it('accepts the configured bearer secret and runs the invocation', async () => {
    const response = await post({ authorization: 'Bearer runtime-test-secret' });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"done"');
    expect(runInvocation).toHaveBeenCalledOnce();
  });

  it('fails closed when the local runtime has no configured secret', async () => {
    delete process.env.VOCION_AGENT_RUNTIME_SECRET;

    const response = await post({ authorization: 'Bearer runtime-test-secret' });

    expect(response.status).toBe(401);
    expect(runInvocation).not.toHaveBeenCalled();
  });

  it('trusts the managed AgentCore transport only when explicitly configured', async () => {
    process.env.VOCION_AGENT_RUNTIME_AUTH_MODE = 'agentcore';

    const response = await post();

    expect(response.status).toBe(200);
    expect(runInvocation).toHaveBeenCalledOnce();
  });
});
