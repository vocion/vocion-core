/**
 * Learnings digest middleware — makes approved rules APPLIED, not discoverable.
 *
 * Approved learnings mount into the agent's virtual filesystem (today at
 * `/learnings/<step>.md`, Phase 1 at `/memories/…`), but nothing ever told the
 * model those files exist: deepagents' skills auto-loader enumerates only
 * `/skills/` and `/playbooks/`, so a human-approved rule was applied only if
 * the model happened to `ls`. This middleware closes that gap structurally
 * (see CLAUDE.md "structural over prompting"): every model call gets the
 * rendered rules appended to the system message, read from the same graph
 * state the files already live in — no extra query, no reliance on the model
 * choosing to look.
 *
 * Deliberately NOT deepagents' `createMemoryMiddleware`: its injected prompt
 * instructs the agent to write memories itself via `edit_file`, which would
 * bypass the human approval gate (the gate is policy — a poisoned "learning"
 * is a persistent prompt injection). Same mechanism, gate-safe guidance.
 *
 * Mirror of `packages/core/src/services/agents/memoryDigest.ts` — the
 * container artifact has no access to core modules. Keep the two in sync.
 */

import { SystemMessage } from '@langchain/core/messages';
import { StateSchema } from '@langchain/langgraph';
import { filesValue } from 'deepagents';
import { createMiddleware } from 'langchain';

/** Paths under these prefixes are approved-memory mounts. */
const MEMORY_PREFIXES = ['/learnings/', '/memories/'];

/**
 * Rules are short; a digest past this size means a namespace needs
 * consolidation, not a bigger prompt. Truncation keeps whole files.
 */
const MAX_DIGEST_CHARS = 24_000;

const GUIDANCE = [
  'The <approved_learnings> block above holds rules a human reviewer approved from past feedback.',
  'They are requirements, not suggestions: apply every rule relevant to this turn.',
  'You cannot edit these files; approval is the only write path.',
  'When feedback in this conversation is worth keeping as a rule, propose it (add_learning where available) — a person decides.',
].join(' ');

type FileLike = { content?: unknown } | string;

/**
 * Extract text from a state file entry (FileData object or bare string).
 * @param entry - One value from the state's `files` record.
 */
function fileText(entry: FileLike): string | null {
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry.content === 'string') {
    return entry.content;
  }
  return null;
}

/**
 * Render the digest from the graph's mounted files. Exported for the unit
 * test and for the memories-mounted event (same selection logic).
 * @param files - The graph state's `files` record.
 */
export function renderMemoryDigest(files: Record<string, FileLike> | undefined): string | null {
  if (!files) {
    return null;
  }
  const paths = Object.keys(files)
    .filter(p => MEMORY_PREFIXES.some(prefix => p.startsWith(prefix)))
    .sort();
  const sections: string[] = [];
  let used = 0;
  let truncated = 0;
  for (const path of paths) {
    const text = fileText(files[path]!);
    if (!text || !text.trim()) {
      continue;
    }
    const section = `### ${path}\n${text.trim()}`;
    if (used + section.length > MAX_DIGEST_CHARS) {
      truncated++;
      continue;
    }
    used += section.length;
    sections.push(section);
  }
  if (sections.length === 0) {
    return null;
  }
  if (truncated > 0) {
    sections.push(`(${truncated} more memory file(s) omitted for length — read them under ${MEMORY_PREFIXES.join(' or ')}.)`);
  }
  return sections.join('\n\n');
}

/**
 * The paths the digest would include — what the memories-mounted event reports.
 * @param files - The graph state's `files` record.
 */
export function memoryMountPaths(files: Record<string, FileLike> | undefined): string[] {
  if (!files) {
    return [];
  }
  return Object.keys(files)
    .filter(p => MEMORY_PREFIXES.some(prefix => p.startsWith(prefix)))
    .sort();
}

/**
 * Middleware that appends the approved-learnings digest to every model call's
 * system message. Stateless: reads the files channel each call, so a rule
 * mounted for this turn is in force for every model call of the turn,
 * including after context summarization.
 */
export function createMemoryDigestMiddleware() {
  return createMiddleware({
    name: 'VocionMemoryDigestMiddleware',
    // A middleware's `request.state` carries ONLY the channels it declares.
    // Without this the files channel is invisible here and the digest is
    // silently empty — the whole middleware no-ops. `filesValue` is
    // deepagents' own channel definition, shared so the two declarations
    // cannot conflict.
    stateSchema: new StateSchema({ files: filesValue }),
    wrapModelCall(request, handler) {
      const state = request.state as { files?: Record<string, FileLike> } | undefined;
      const digest = renderMemoryDigest(state?.files);
      if (process.env.VOCION_DEBUG_MEMORY_DIGEST) {
        console.error(`[memoryDigest] files=${Object.keys(state?.files ?? {}).length} digest=${digest ? digest.length : 0}`);
      }
      if (!digest) {
        return handler(request);
      }
      const section = `<approved_learnings>\n${digest}\n</approved_learnings>\n\n${GUIDANCE}`;
      const existing = request.systemMessage.content;
      const merged = new SystemMessage({
        content: [
          ...(typeof existing === 'string'
            ? [{ type: 'text' as const, text: existing }]
            : Array.isArray(existing) ? existing : []),
          { type: 'text' as const, text: section },
        ],
      });
      return handler({ ...request, systemMessage: merged });
    },
  });
}
