/**
 * Turning a thrown value into the string a failed mission task carries.
 *
 * The task row is the only durable record of why a run died, so `.message`
 * alone throws most of the evidence away. Two shapes hide their real cause:
 *
 *   - LangGraph raises a plain `AggregateError` when more than one node fails
 *     in the same superstep (`@langchain/langgraph`, `pregel/runner`). Its
 *     message names none of them and points at an `errors` array instead.
 *   - A wrapped failure reads as something generic like "tool error" while the
 *     `cause` holds what actually broke.
 *
 * So walk both, keeping one stack frame per error to say where it came from.
 */

/** How much of the description to keep. Long enough for a handful of nested tool failures, short enough not to bloat the run row. */
const MAX_FAILURE_CHARS = 4_000;

/** How deep to follow nested `errors` and `cause` links before giving up. */
const MAX_DEPTH = 3;

type ErrorLike = Partial<Error> & { errors?: unknown; cause?: unknown };

/**
 * Describe a thrown value, one error per line, nested causes indented.
 * @param err - Whatever was thrown. Not necessarily an Error.
 * @returns A capped, indented description. Never empty.
 */
export function describeTaskFailure(err: unknown): string {
  const lines: string[] = [];

  const describe = (value: unknown, indent: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      lines.push(`${indent}... (nesting cut off)`);
      return;
    }

    const error = (value ?? {}) as ErrorLike;
    const name = typeof error.name === 'string' ? error.name : 'Error';
    const message = typeof error.message === 'string' ? error.message : String(value);
    lines.push(`${indent}${name}: ${message}`);

    // The frame after the header line is where the throw happened. The rest of
    // the stack is the runtime's own plumbing and is not worth the characters.
    const frame = typeof error.stack === 'string' ? error.stack.split('\n')[1]?.trim() : undefined;
    if (frame) {
      lines.push(`${indent}  at ${frame.replace(/^at\s+/, '')}`);
    }

    if (Array.isArray(error.errors)) {
      for (const sub of error.errors) {
        describe(sub, `${indent}  `, depth + 1);
      }
    }

    if (error.cause !== undefined && error.cause !== null) {
      describe(error.cause, `${indent}  `, depth + 1);
    }
  };

  describe(err, '', 0);

  const text = lines.join('\n');

  return text.length > MAX_FAILURE_CHARS
    ? `${text.slice(0, MAX_FAILURE_CHARS)}\n... (truncated)`
    : text;
}
