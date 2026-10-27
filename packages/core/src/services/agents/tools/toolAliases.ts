/**
 * Old tool names, still answered for one release after a rename.
 *
 * A rename reaches the model's catalog at once, but not what was written
 * against the old name: a workspace's stored prompts and skills, an agent's
 * `harness.grantTools` / `excludeTools`, the tool-call history the hot-tool
 * tiering reads, and an older agent-runtime container calling back by name.
 * Each of those reads the name through `canonicalToolName`, and a call made
 * under an old name runs as the new tool (`createToolAliasMiddleware` in the
 * in-process loop, `executeToolCall` on the container's callback).
 *
 * The catalog the model sees carries only the new names; each renamed tool's
 * description says "(Formerly …)" so a prompt naming the old one still points
 * the model at the right tool.
 */

import { createMiddleware } from 'langchain';
import { PROJECT_TOOL_ALIASES } from './projects';

/** Old name → new name. Each rename lists its aliases beside its tools. */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  ...PROJECT_TOOL_ALIASES,
};

/**
 * Argument names renamed with their tools, by the tool's current name: an old
 * call's `room_id` is the new `project_id` on the project tools and on every
 * tool that files its output on a project; `extract_records`' `room` is
 * `project`.
 */
const ARG_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ...Object.fromEntries(
    [...Object.values(PROJECT_TOOL_ALIASES), 'add_open_item', 'fetch_image', 'render_document', 'render_deck'].map(name => [name, { room_id: 'project_id' }]),
  ),
  extract_records: { room: 'project' },
};

/**
 * The current name for a tool name, old or new.
 * @param name - A tool name as written anywhere.
 */
export function canonicalToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/**
 * A list of tool names with every old name read as its new one.
 * @param names - Names as configured (`grantTools`, `excludeTools`, history).
 */
export function canonicalToolNames(names: readonly string[] | null | undefined): string[] {
  return (names ?? []).map(canonicalToolName);
}

/**
 * A call's arguments under the new tool's argument names: an old name the
 * new tool renamed moves across unless the new one is already there.
 * @param tool - The tool's current name.
 * @param args - The arguments as called.
 */
export function canonicalToolArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const renames = ARG_ALIASES[tool];
  if (!renames || !args || typeof args !== 'object' || !Object.keys(renames).some(k => k in args)) {
    return args;
  }
  const out = { ...args };
  for (const [from, to] of Object.entries(renames)) {
    if (from in out) {
      if (!(to in out)) {
        out[to] = out[from];
      }
      delete out[from];
    }
  }
  return out;
}

/**
 * A call as the tool it is now: the new name for an old one, and the new
 * argument names for old ones. The same call back when nothing was old.
 * @param call - The call as the model made it.
 * @param call.name - The tool name it used.
 * @param call.args - Its arguments.
 * @param known - Whether the loop has a tool under that name; a name it has is never renamed.
 */
export function canonicalToolCall<T extends { name: string; args: Record<string, unknown> }>(call: T, known: boolean): T {
  const name = known ? call.name : canonicalToolName(call.name);
  const args = canonicalToolArgs(name, call.args);
  return name === call.name && args === call.args ? call : { ...call, name, args };
}

/**
 * Runs a call made under an old tool name, or with an old argument name, as
 * the tool it became. Only a name the loop does not know is renamed, so a tool
 * still registered under an old name is never shadowed.
 */
export function createToolAliasMiddleware() {
  return createMiddleware({
    name: 'VocionToolAliases',
    wrapToolCall: async (request, handler) => {
      const call = canonicalToolCall(request.toolCall as { name: string; args: Record<string, unknown> }, request.tool !== undefined);
      return call === request.toolCall ? handler(request) : handler({ ...request, toolCall: { ...request.toolCall, ...call } });
    },
  });
}
