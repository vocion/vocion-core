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

/**
 * Make a failed tool call visible to something other than the model.
 *
 * The executor returns the failure as the tool's output, which is right — the
 * model can then say it could not look something up. But nothing obliges it
 * to, and the single most common deployment mistake is a tool endpoint AWS
 * cannot reach, where every tool fails the same way and the agent answers
 * fluently from the model alone. That reads as a bad model rather than bad
 * configuration.
 *
 * So the failure also goes out as a typed `tool_error` event for core to log
 * and alert on, and to this process's stderr for whoever is reading container
 * logs. Neither depends on the model's cooperation.
 * @param emit - This invocation's event sink.
 * @param toolName - The catalog entry that failed.
 * @param message - What went wrong, already trimmed for display.
 * @param status - HTTP status, when the endpoint answered at all.
 */
function reportToolFailure(
  emit: (event: AgentEvent) => void,
  toolName: string,
  message: string,
  status?: number,
): void {
  console.error(`[agent-runtime] tool ${toolName} failed: ${message}`);
  emit({ type: 'tool_error', tool: toolName, message, ...(status === undefined ? {} : { status }) });
}

export function buildTransportTools(
  spec: InvocationRequest['tools'],
  emit: (event: AgentEvent) => void,
): StructuredToolInterface[] {
  return spec.catalog.map(entry =>
    tool(
      async (input: unknown, config?: { metadata?: { checkpoint_ns?: unknown } }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
        // checkpoint_ns rides along so the core-side tool_call record can
        // attribute a delegated specialist's call. Attribution only.
        const cp = config?.metadata?.checkpoint_ns;
        const ns = typeof cp === 'string' ? cp : Array.isArray(cp) ? cp.join('|') : undefined;
        try {
          const res = await fetch(spec.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${spec.claim}`,
            },
            body: JSON.stringify({ tool: entry.name, input: input ?? {}, ...(ns ? { ns } : {}) }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const detail = `endpoint returned ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`;
            reportToolFailure(emit, entry.name, detail, res.status);
            return `Tool error: ${detail}`;
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
          reportToolFailure(emit, entry.name, message);
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
