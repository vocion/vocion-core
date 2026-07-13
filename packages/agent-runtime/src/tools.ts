/**
 * Transport-backed tools.
 *
 * The runtime never implements domain tools — it rebuilds each catalog
 * entry as a LangChain tool whose executor POSTs to the configured tool
 * endpoint with the invocation's signed tenant claim. The endpoint
 * (vocion-core's internal tool API today; an AgentCore Gateway target
 * later) executes the real implementation next to Postgres and returns
 * `{ output, events }`; any side-channel events (documents sidebar,
 * skill_result cards, hitl gates) are re-emitted into this run's stream.
 *
 * This is the transport seam: laptop and cloud differ only in the URL.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AgentEvent, InvocationRequest, ToolCallResult } from './contract.js';
import { tool } from '@langchain/core/tools';

const TOOL_TIMEOUT_MS = Number(process.env.VOCION_TOOL_TIMEOUT_MS ?? 120_000);

export function buildTransportTools(
  spec: InvocationRequest['tools'],
  emit: (event: AgentEvent) => void,
): StructuredToolInterface[] {
  return spec.catalog.map(entry =>
    tool(
      async (input: unknown) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
        try {
          const res = await fetch(spec.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${spec.claim}`,
            },
            body: JSON.stringify({ tool: entry.name, input: input ?? {} }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            return `Tool error: endpoint returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`;
          }
          const result = (await res.json()) as ToolCallResult;
          for (const event of result.events ?? []) {
            emit(event);
          }
          return result.output;
        } catch (err) {
          const message = (err as Error).name === 'AbortError'
            ? `timed out after ${TOOL_TIMEOUT_MS}ms`
            : (err as Error).message;
          return `Tool error: ${message}`;
        } finally {
          clearTimeout(timer);
        }
      },
      {
        name: entry.name,
        description: entry.description,
        // LangChain 1.x accepts a plain JSON Schema object here.
        schema: entry.inputSchema as never,
      },
    ),
  );
}
