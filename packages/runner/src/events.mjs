// The worker's run events: the small, structured timeline Vocion stores beside a worker_run so a
// run page can read like a GitHub Actions run. Two jobs live here, both pure so they can be tested
// without a network or a child process:
//
//   the event buffer    every phase the worker logs becomes one event (seq, ts, phase, level?,
//                        message?, fields?), batched onto heartbeat/complete/fail per the fixed
//                        contract (at most 200 a request, idempotent on seq, capped at 5000
//                        buffered so a stuck heartbeat cannot grow this without bound).
//   the stream reader   Claude now runs with --output-format stream-json --verbose; this turns
//                        each line into claude.tool / claude.tool.result events and picks out the
//                        one line that carries the same shape --output-format json used to print
//                        whole, so claude.finished and everything downstream reads unchanged.
//
// No bulk bytes cross this module: a claude.tool event's target is at most 200 characters, an
// error at most 300, and nothing here ever attaches a tool's full output to an event.

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_FIELDS_BYTES = 8000;
export const MAX_TARGET_CHARS = 200;
export const MAX_ERROR_CHARS = 300;
// What the run page draws the way a Claude Code terminal does (Chris, 2026-09-29): the engineer's
// own words, an edit as +/- lines, and the start of what a command printed.
export const MAX_TEXT_CHARS = 1500;
export const MAX_DIFF_LINES = 40;
export const MAX_OUTPUT_LINES = 12;
export const MAX_BATCH = 200;
export const DEFAULT_CAP = 5000;

export function truncate(s, max) {
  const str = String(s ?? '');
  return str.length > max ? str.slice(0, max) : str;
}

/**
 * Shrinks the longest string field, repeatedly, until the serialized object fits in maxBytes, or
 * there is nothing left worth cutting. Never throws, never drops a key: a field that cannot shrink
 * enough is left short rather than the event being refused.
 */
export function fitFields(fields, maxBytes = MAX_FIELDS_BYTES) {
  if (!fields || typeof fields !== 'object') {
    return fields;
  }
  const obj = { ...fields };
  const bytes = () => Buffer.byteLength(JSON.stringify(obj));
  for (let i = 0; i < 100 && bytes() > maxBytes; i++) {
    let key = null;
    let len = -1;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.length > len) {
        len = v.length; key = k;
      }
    }
    if (key === null || len <= 20) {
      break;
    }
    obj[key] = `${obj[key].slice(0, Math.max(10, Math.floor(len / 2)))}...(truncated)`;
  }
  return obj;
}

/** True once a heartbeat's rejection is plausibly about the events it carried, not the run itself. */
export function looksLikeEventsRejection(status, json) {
  if (!(status >= 400 && status < 500)) {
    return false;
  }
  const text = `${json?.error || ''} ${json?.message || ''}`.toLowerCase();
  return text.includes('event') || text.includes('validation');
}

/**
 * The buffer of run events waiting to reach Vocion. `add` assigns the next per-run seq (starting
 * at 1) and drops `heartbeat` itself, the contract's own words for what never needs a place on the
 * timeline. Once the backlog reaches `cap`, further claude.tool / claude.tool.result events (the
 * only ones frequent enough to matter) are dropped and folded into one running warn event instead
 * of the buffer growing without bound while a heartbeat is stuck.
 */
export function createEventLog({ cap = DEFAULT_CAP } = {}) {
  let seq = 0;
  let unsent = [];
  let droppedCount = 0;
  let dropEvent = null;
  let disabled = false;

  function add(phase, { level, message, fields, ts } = {}) {
    if (disabled || phase === 'heartbeat') {
      return null;
    }
    if (unsent.length >= cap && (phase === 'claude.tool' || phase === 'claude.tool.result')) {
      droppedCount += 1;
      if (dropEvent) {
        dropEvent.message = `${droppedCount} claude.tool event(s) dropped: run event buffer full (${cap})`;
      } else {
        dropEvent = { seq: (seq += 1), ts: ts || new Date().toISOString(), phase: 'events.dropped', level: 'warn', message: `${droppedCount} claude.tool event(s) dropped: run event buffer full (${cap})` };
        unsent.push(dropEvent);
      }
      return null;
    }
    const ev = { seq: (seq += 1), ts: ts || new Date().toISOString(), phase };
    if (level) {
      ev.level = level;
    }
    if (message !== undefined && message !== null && message !== '') {
      ev.message = truncate(message, MAX_MESSAGE_CHARS);
    }
    if (fields && Object.keys(fields).length) {
      ev.fields = fitFields(fields);
    }
    unsent.push(ev);
    return ev;
  }

  function nextBatch(max = MAX_BATCH) {
    return unsent.slice(0, max);
  }
  function hasPending() {
    return unsent.length > 0;
  }
  /**
   * Advances past whatever the core actually stored. `eventsAccepted` (the contract's own reply)
   * is authoritative when present; an older core that answers 2xx with no such field is read, per
   * the contract, as having taken the whole batch.
   */
  function ack(batch, eventsAccepted) {
    if (!batch.length) {
      return;
    }
    const through = typeof eventsAccepted === 'number' ? eventsAccepted : batch[batch.length - 1].seq;
    unsent = unsent.filter(e => e.seq > through);
  }
  function disable() {
    disabled = true;
  }
  function isDisabled() {
    return disabled;
  }
  return {
    add,
    nextBatch,
    hasPending,
    ack,
    disable,
    isDisabled,
    get size() {
      return unsent.length;
    },
    get droppedCount() {
      return droppedCount;
    },
  };
}

// ---------- stream-json ----------

/** Buffers partial reads from a child process and calls `onLine` once per complete line, in order. */
export function lineSplitter(onLine) {
  let carry = '';
  return {
    push(chunk) {
      carry += chunk;
      for (let i = carry.indexOf('\n'); i >= 0; i = carry.indexOf('\n')) {
        const line = carry.slice(0, i);
        carry = carry.slice(i + 1);
        if (line.trim()) {
          onLine(line);
        }
      }
    },
    flush() {
      if (carry.trim()) {
        onLine(carry);
      }
      carry = '';
    },
  };
}

function toolTarget(input) {
  if (!input || typeof input !== 'object') {
    return '';
  }
  const v = input.file_path ?? input.command ?? input.pattern ?? input.url ?? '';
  return truncate(v, MAX_TARGET_CHARS);
}

/**
 * An edit as `-`/`+` lines, the way the terminal shows it: removed lines then added ones, each
 * side capped, so one large write never floods the log. Null for a tool that edits nothing.
 */
export function toolDiff(name, input) {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const side = (text, mark) => String(text ?? '').replace(/\s+$/, '').split('\n').map(l => `${mark} ${l}`);
  let lines = [];
  if (name === 'Edit') {
    lines = [...side(input.old_string, '-'), ...side(input.new_string, '+')];
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    lines = input.edits.flatMap(e => [...side(e?.old_string, '-'), ...side(e?.new_string, '+')]);
  } else if (name === 'Write') {
    lines = side(input.content, '+');
  } else {
    return null;
  }
  lines = lines.filter(l => l !== '- ' && l !== '+ ');
  if (lines.length === 0) {
    return null;
  }
  const kept = lines.slice(0, MAX_DIFF_LINES).map(l => truncate(l, MAX_TARGET_CHARS));
  if (lines.length > MAX_DIFF_LINES) {
    kept.push(`… ${lines.length - MAX_DIFF_LINES} more lines`);
  }
  return kept.join('\n');
}

/** The start of what a command printed, a few lines, each capped. */
export function outputHead(content) {
  const text = blockText(content).replace(/\s+$/, '');
  if (!text) {
    return null;
  }
  const lines = text.split('\n');
  const kept = lines.slice(0, MAX_OUTPUT_LINES).map(l => truncate(l, MAX_TARGET_CHARS));
  if (lines.length > MAX_OUTPUT_LINES) {
    kept.push(`… ${lines.length - MAX_OUTPUT_LINES} more lines`);
  }
  return kept.join('\n');
}

function blockText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(c => (typeof c === 'string' ? c : c?.text || '')).join(' ');
  }
  return '';
}

// Bash calls whose results are still to come: a tool_result names only the call's id, and only a
// command's output is worth showing. Bounded, so a run that never sees a result cannot grow it.
const pendingBash = new Set();

/**
 * One parsed stream-json line to zero or more run events. An assistant turn's tool_use blocks
 * become `claude.tool`; the matching tool_result, which Claude Code prints as a `user` message,
 * becomes `claude.tool.result`. Everything else (plain text, system lines, the final `result`)
 * carries no event of its own; `isFinalResult` below is how the worker still gets cost, duration
 * and the model, exactly as it read the whole `--output-format json` object before.
 */
export function messageEvents(message) {
  const events = [];
  if (!message || typeof message !== 'object') {
    return events;
  }
  const content = message.message?.content;
  if (message.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        events.push({ phase: 'claude.text', fields: { text: truncate(block.text.trim(), MAX_TEXT_CHARS) } });
      } else if (block?.type === 'tool_use') {
        const fields = { tool: block.name, target: toolTarget(block.input), id: block.id };
        const diff = toolDiff(block.name, block.input);
        if (diff) {
          fields.diff = diff;
        }
        if (block.name === 'Bash' && block.id) {
          pendingBash.add(block.id);
          if (pendingBash.size > 200) {
            pendingBash.delete(pendingBash.values().next().value);
          }
        }
        events.push({ phase: 'claude.tool', fields });
      }
    }
  } else if (message.type === 'user' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== 'tool_result') {
        continue;
      }
      const ok = !block.is_error;
      const fields = { id: block.tool_use_id, ok };
      if (!ok) {
        fields.error = truncate(blockText(block.content), MAX_ERROR_CHARS);
      } else if (pendingBash.has(block.tool_use_id)) {
        const out = outputHead(block.content);
        if (out) {
          fields.output = out;
        }
      }
      pendingBash.delete(block.tool_use_id);
      events.push({ phase: 'claude.tool.result', level: ok ? undefined : 'error', fields });
    }
  }
  return events;
}

/** The one line stream-json prints last: the same shape `--output-format json` used to print whole. */
export function isFinalResult(message) {
  return Boolean(message) && message.type === 'result';
}

// ---------- a transcript a person can open ----------

/**
 * A markdown rendering of the stream: what the assistant said, each tool call with its target and
 * outcome, then the final report. Uploaded as transcript.md, plain text a browser renders, next to
 * the gzipped raw jsonl a person would otherwise have to pull apart by hand.
 */
export function renderTranscriptMarkdown(messages, { taskId, runId } = {}) {
  const lines = [`# Claude transcript${taskId ? ` for ${taskId}` : ''}`, '', `Vocion worker run: ${runId ?? '(local)'}`, ''];
  const pending = new Map(); // tool_use id -> { tool, target }
  let final = null;
  for (const message of messages || []) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block?.type === 'text' && block.text) {
          lines.push(truncate(block.text, 1000), '');
        }
        if (block?.type === 'tool_use') {
          const target = toolTarget(block.input);
          pending.set(block.id, { tool: block.name, target });
          lines.push(`- **${block.name}** \`${target || '(no target)'}\``);
        }
      }
    } else if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block?.type !== 'tool_result') {
          continue;
        }
        const call = pending.get(block.tool_use_id);
        const ok = !block.is_error;
        const label = call ? `${call.tool} \`${call.target || ''}\`` : block.tool_use_id;
        lines.push(`  ${ok ? 'ok' : 'FAILED'}: ${label}${ok ? '' : `, ${truncate(blockText(block.content), 300)}`}`);
      }
    } else if (isFinalResult(message)) {
      final = message;
    }
  }
  if (final) {
    const model = final.modelUsage ? Object.keys(final.modelUsage).join(', ') : 'unknown';
    lines.push('', '## Result', '', `Model: ${model}`, `Cost: $${Number(final.total_cost_usd || 0).toFixed(4)}`, `Turns: ${final.num_turns ?? '?'}`, '', truncate(final.result || '', 4000));
  }
  return lines.join('\n');
}

/**
 * WHAT A RUN SPENT BEFORE IT WAS CUT OFF (walk 20, FE-436, 2026-10-04). A run killed at the wall
 * clock never prints its `result` line, and its cost read $0 while forty minutes of Opus had run.
 * Every `assistant` message in the stream carries that call's usage and model, so the spend is
 * summed from them: not what the session would have reported, but never nothing. Null when no
 * assistant message carried usage.
 * @param messages - The parsed stream-json messages.
 */
export function usageFromMessages(messages) {
  let model = null;
  const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let any = false;
  for (const m of messages || []) {
    const msg = m && m.type === 'assistant' && m.message && typeof m.message === 'object' ? m.message : null;
    const u = msg && msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
    if (!u) {
      continue;
    }
    any = true;
    model = model || (typeof msg.model === 'string' && msg.model ? msg.model : null);
    sum.inputTokens += Number(u.input_tokens) || 0;
    sum.cacheWriteTokens += Number(u.cache_creation_input_tokens) || 0;
    sum.cacheReadTokens += Number(u.cache_read_input_tokens) || 0;
    sum.outputTokens += Number(u.output_tokens) || 0;
  }
  if (!any) {
    return null;
  }
  return { model, inputTokens: sum.inputTokens + sum.cacheWriteTokens + sum.cacheReadTokens, outputTokens: sum.outputTokens, cacheReadTokens: sum.cacheReadTokens, cacheWriteTokens: sum.cacheWriteTokens };
}
