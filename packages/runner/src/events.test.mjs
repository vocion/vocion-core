import assert from 'node:assert/strict';
// node --test packages/runner/src/events.test.mjs
// The run event buffer (seq, batching, the eventsAccepted fallback, the 5000 cap) and the
// stream-json reader (tool call / tool result events, the final result line, the transcript
// rendering) against a small fixture of fictional content. No network, no child process.
import { describe, it } from 'node:test';
import {
  createEventLog,
  fitFields,
  isFinalResult,
  lineSplitter,
  looksLikeEventsRejection,
  MAX_BATCH,
  MAX_ERROR_CHARS,
  MAX_FIELDS_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_TARGET_CHARS,
  messageEvents,
  outputHead,
  renderTranscriptMarkdown,
  toolDiff,
  truncate,
  usageFromMessages,
} from './events.mjs';

describe('truncate', () => {
  it('leaves a short string alone', () => {
    assert.equal(truncate('hi', 10), 'hi');
  });

  it('cuts a long one to the limit', () => {
    assert.equal(truncate('a'.repeat(20), 5).length, 5);
  });

  it('reads null and undefined as empty', () => {
    assert.equal(truncate(null, 5), ''); assert.equal(truncate(undefined, 5), '');
  });
});

describe('fitFields', () => {
  it('returns small objects untouched', () => {
    const fields = { tool: 'Bash', target: 'npm test', id: 'toolu_1' };
    assert.deepEqual(fitFields(fields), fields);
  });

  it('shrinks the longest string field until the object fits 8KB', () => {
    const fields = { id: 'toolu_2', output: 'x'.repeat(20000) };
    const fitted = fitFields(fields, MAX_FIELDS_BYTES);
    assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= MAX_FIELDS_BYTES);
    assert.equal(fitted.id, 'toolu_2');
    assert.ok(fitted.output.length < fields.output.length);
  });

  it('never drops a key, even one it cannot shrink much further', () => {
    const fields = { a: 'y'.repeat(9000), b: 'z'.repeat(9000) };
    const fitted = fitFields(fields, 500);
    assert.ok('a' in fitted && 'b' in fitted);
  });

  it('passes through a non-object unchanged', () => {
    assert.equal(fitFields(null), null);
    assert.equal(fitFields(undefined), undefined);
  });
});

describe('looksLikeEventsRejection', () => {
  it('reads a 4xx naming events as an events problem', () => {
    assert.equal(looksLikeEventsRejection(400, { error: 'events[2].seq must be an integer' }), true);
  });

  it('reads a 4xx naming validation as an events problem', () => {
    assert.equal(looksLikeEventsRejection(422, { message: 'Validation failed' }), true);
  });

  it('leaves an ordinary 403 (lease lost) alone', () => {
    assert.equal(looksLikeEventsRejection(403, { error: 'lease held by another worker' }), false);
  });

  it('leaves a 5xx alone; that is Vocion, not the events payload', () => {
    assert.equal(looksLikeEventsRejection(500, { error: 'events broke everything' }), false);
  });
});

describe('createEventLog: seq, batching, the eventsAccepted fallback', () => {
  it('assigns seq starting at 1, increasing', () => {
    const log = createEventLog();
    const a = log.add('boot', { message: 'starting' });
    const b = log.add('claim', { message: 'run 42' });
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
  });

  it('skips heartbeat events themselves', () => {
    const log = createEventLog();
    log.add('boot', {});
    const ev = log.add('heartbeat', { message: 'tick' });
    assert.equal(ev, null);
    assert.equal(log.size, 1);
  });

  it('batches at most `max` events, in seq order', () => {
    const log = createEventLog();
    for (let i = 0; i < 5; i++) {
      log.add('check', { message: `check ${i}` });
    }
    const batch = log.nextBatch(3);
    assert.equal(batch.length, 3);
    assert.deepEqual(batch.map(e => e.seq), [1, 2, 3]);
  });

  it('defaults the batch size to 200', () => {
    const log = createEventLog();
    for (let i = 0; i < 250; i++) {
      log.add('claude.tool', { fields: { tool: 'Bash', target: `cmd ${i}`, id: `t${i}` } });
    }
    assert.equal(log.nextBatch().length, MAX_BATCH);
  });

  it('advances the sent mark from eventsAccepted when the core sends one', () => {
    const log = createEventLog();
    for (let i = 0; i < 5; i++) {
      log.add('check', {});
    }
    const batch = log.nextBatch();
    log.ack(batch, 3); // core only stored up to seq 3
    assert.equal(log.size, 2);
    assert.deepEqual(log.nextBatch().map(e => e.seq), [4, 5]);
  });

  it('falls back to the whole batch when an older core answers with no eventsAccepted', () => {
    const log = createEventLog();
    for (let i = 0; i < 4; i++) {
      log.add('check', {});
    }
    const batch = log.nextBatch();
    log.ack(batch, undefined);
    assert.equal(log.hasPending(), false);
  });

  it('truncates a message over 2000 characters', () => {
    const log = createEventLog();
    const ev = log.add('claude.finished', { message: 'x'.repeat(MAX_MESSAGE_CHARS + 500) });
    assert.equal(ev.message.length, MAX_MESSAGE_CHARS);
  });

  it('carries level and fields through untouched when they fit', () => {
    const log = createEventLog();
    const ev = log.add('verify.failed', { level: 'error', message: 'checks failed', fields: { files: ['a.ts'] } });
    assert.equal(ev.level, 'error');
    assert.deepEqual(ev.fields, { files: ['a.ts'] });
  });

  it('once disabled, stops adding events, including the disabling one', () => {
    const log = createEventLog();
    log.add('boot', {});
    log.disable();
    assert.equal(log.isDisabled(), true);
    assert.equal(log.add('events.disabled', { message: 'stopping' }), null);
    assert.equal(log.size, 1);
  });
});

describe('createEventLog: the 5000 cap', () => {
  it('drops claude.tool events past the cap and folds them into one warn event', () => {
    const log = createEventLog({ cap: 5 });
    for (let i = 0; i < 5; i++) {
      log.add('claude.tool', { fields: { tool: 'Bash', target: `cmd ${i}`, id: `t${i}` } });
    }
    assert.equal(log.size, 5);
    for (let i = 0; i < 10; i++) {
      log.add('claude.tool', { fields: { tool: 'Bash', target: `overflow ${i}`, id: `o${i}` } });
    }
    // Five real events, plus exactly one dropped-warning event, however many were dropped.
    assert.equal(log.size, 6);
    assert.equal(log.droppedCount, 10);
    const warn = log.nextBatch().find(e => e.phase === 'events.dropped');
    assert.ok(warn);
    assert.equal(warn.level, 'warn');
    assert.match(warn.message, /10 claude\.tool event\(s\) dropped/);
  });

  it('keeps admitting non-claude.tool events past the cap (they are rare)', () => {
    const log = createEventLog({ cap: 2 });
    log.add('claude.tool', {});
    log.add('claude.tool', {});
    log.add('claude.tool', {}); // dropped, folded into the warn event
    const ev = log.add('verify.failed', { message: 'checks failed' });
    assert.ok(ev);
    // 2 admitted tool events, 1 warn event for the dropped one, and this one: 4.
    assert.equal(log.size, 4);
  });
});

describe('lineSplitter', () => {
  it('calls onLine once per complete line, across chunk boundaries', () => {
    const lines = [];
    const s = lineSplitter(l => lines.push(l));
    s.push('{"a":1}\n{"b":2');
    s.push('}\n{"c":3}\n');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('flushes a trailing line with no newline', () => {
    const lines = [];
    const s = lineSplitter(l => lines.push(l));
    s.push('{"a":1}\n{"trailing":true}');
    s.flush();
    assert.deepEqual(lines, ['{"a":1}', '{"trailing":true}']);
  });

  it('skips blank lines', () => {
    const lines = [];
    const s = lineSplitter(l => lines.push(l));
    s.push('{"a":1}\n\n\n{"b":2}\n');
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  });
});

// A small fixture of fictional content shaped like `claude -p --output-format stream-json
// --verbose` on a made-up task: one tool call that succeeds, one that fails, then the result line.
const FIXTURE = {
  toolUse: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'text', text: 'Reading the fixture file.' },
    { type: 'tool_use', id: 'toolu_kestrel_1', name: 'Read', input: { file_path: '/workspace/repo/packages/kestrel/index.ts' } },
  ] } },
  toolResultOk: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_kestrel_1', content: [{ type: 'text', text: 'export const kestrel = 1;' }], is_error: false },
  ] } },
  toolUseFailing: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'toolu_kestrel_2', name: 'Bash', input: { command: 'npm run typecheck -w @kestrel/widgets' } },
  ] } },
  toolResultFail: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_kestrel_2', content: [{ type: 'text', text: 'error TS2345: widget.ts does not exist' }], is_error: true },
  ] } },
  system: { type: 'system', subtype: 'init', session_id: 'sess_kestrel' },
  result: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.42,
    num_turns: 3,
    result: 'Fixed the widget type and reran typecheck.',
    usage: { input_tokens: 1000, output_tokens: 200 },
    modelUsage: { 'claude-kestrel-4': { costUSD: 0.42 } },
    permission_denials: [],
  },
};

describe('messageEvents: stream-json lines to run events', () => {
  it('turns a tool_use block into a claude.tool event with a bounded target', () => {
    const events = messageEvents(FIXTURE.toolUse).filter(e => e.phase === 'claude.tool');
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, 'claude.tool');
    assert.deepEqual(events[0].fields, { tool: 'Read', target: '/workspace/repo/packages/kestrel/index.ts', id: 'toolu_kestrel_1' });
  });

  it('reads command for a Bash call with no file_path', () => {
    const events = messageEvents(FIXTURE.toolUseFailing).filter(e => e.phase === 'claude.tool');
    assert.equal(events[0].fields.target, 'npm run typecheck -w @kestrel/widgets');
  });

  it('truncates a target over 200 characters', () => {
    const events = messageEvents({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'x'.repeat(300) } }] } });
    assert.equal(events[0].fields.target.length, MAX_TARGET_CHARS);
  });

  it('turns a passing tool_result into an ok event with no error', () => {
    const events = messageEvents(FIXTURE.toolResultOk);
    assert.equal(events.length, 1);
    assert.equal(events[0].phase, 'claude.tool.result');
    assert.equal(events[0].level, undefined);
    assert.deepEqual(events[0].fields, { id: 'toolu_kestrel_1', ok: true });
  });

  it('turns a failing tool_result into an error event with the error text', () => {
    const events = messageEvents(FIXTURE.toolResultFail);
    assert.equal(events[0].phase, 'claude.tool.result');
    assert.equal(events[0].level, 'error');
    assert.equal(events[0].fields.ok, false);
    assert.equal(events[0].fields.error, 'error TS2345: widget.ts does not exist');
  });

  it('truncates a tool_result error to 300 characters', () => {
    const events = messageEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'x'.repeat(1000) }], is_error: true }] } });
    assert.equal(events[0].fields.error.length, MAX_ERROR_CHARS);
  });

  it('carries no event for system lines or the final result; plain text is the engineer\'s commentary', () => {
    assert.deepEqual(messageEvents(FIXTURE.system), []);
    assert.deepEqual(messageEvents(FIXTURE.result), []);
    assert.deepEqual(messageEvents(null), []);
    assert.deepEqual(messageEvents({ type: 'assistant', message: { content: [{ type: 'text', text: 'just talking' }] } }), [{ phase: 'claude.text', fields: { text: 'just talking' } }]);
    assert.deepEqual(messageEvents({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }] } }), []);
  });
});

describe('isFinalResult', () => {
  it('picks out only the type: result line', () => {
    assert.equal(isFinalResult(FIXTURE.result), true);
    assert.equal(isFinalResult(FIXTURE.toolUse), false);
    assert.equal(isFinalResult(FIXTURE.system), false);
    assert.equal(isFinalResult(null), false);
  });
});

describe('renderTranscriptMarkdown', () => {
  const rendered = renderTranscriptMarkdown(
    [FIXTURE.system, FIXTURE.toolUse, FIXTURE.toolResultOk, FIXTURE.toolUseFailing, FIXTURE.toolResultFail, FIXTURE.result],
    { taskId: 'kestrel-widget-fix', runId: 999 },
  );

  it('names the task and run', () => {
    assert.match(rendered, /kestrel-widget-fix/);
    assert.match(rendered, /999/);
  });

  it('lists each tool call with its target', () => {
    assert.match(rendered, /Read.*\/workspace\/repo\/packages\/kestrel\/index\.ts/);
    assert.match(rendered, /Bash.*npm run typecheck -w @kestrel\/widgets/);
  });

  it('marks the failing call and includes its error text', () => {
    assert.match(rendered, /FAILED.*widget\.ts does not exist/);
  });

  it('marks the passing call ok', () => {
    assert.match(rendered, /ok: Read/);
  });

  it('ends with the final result: model, cost, turns, the report text', () => {
    assert.match(rendered, /claude-kestrel-4/);
    assert.match(rendered, /\$0\.4200/);
    assert.match(rendered, /Turns: 3/);
    assert.match(rendered, /Fixed the widget type and reran typecheck\./);
  });

  it('never contains an em dash', () => {
    assert.equal(rendered.includes(String.fromCharCode(0x2014)), false);
  });
});

describe('the run log reads like a Claude Code terminal', () => {
  it('sends the engineer\'s words, an edit as -/+ lines, and the start of a command\'s output', () => {
    const said = messageEvents({ type: 'assistant', message: { content: [
      { type: 'text', text: 'The route reads the org from the session; the helper should take it.' },
      { type: 'tool_use', id: 'toolu_kestrel_edit', name: 'Edit', input: { file_path: '/workspace/repo/apps/api/src/routes/documents.ts', old_string: 'loadDocument(id)', new_string: 'loadDocument(id, actingOrg)' } },
      { type: 'tool_use', id: 'toolu_kestrel_bash', name: 'Bash', input: { command: 'npm test' } },
    ] } });

    assert.deepEqual(said.map(e => e.phase), ['claude.text', 'claude.tool', 'claude.tool']);
    assert.equal(said[0].fields.text, 'The route reads the org from the session; the helper should take it.');
    assert.equal(said[1].fields.diff, '- loadDocument(id)\n+ loadDocument(id, actingOrg)');
    assert.equal(said[2].fields.diff, undefined);

    const [result] = messageEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_kestrel_bash', content: 'Tests  12 passed (12)\n' }] } });

    assert.equal(result.fields.output, 'Tests  12 passed (12)');

    const [readBack] = messageEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_kestrel_edit', content: 'The file was updated.' }] } });

    assert.equal(readBack.fields.output, undefined);
  });

  it('caps a large write and a long output, and says how much was left out', () => {
    const write = toolDiff('Write', { content: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') });

    assert.equal(write.split('\n').length, 41);
    assert.match(write, /… 10 more lines$/);
    assert.match(outputHead(Array.from({ length: 20 }, (_, i) => `row ${i}`).join('\n')), /… 8 more lines$/);
    assert.equal(toolDiff('Read', { file_path: 'x' }), null);
  });
});

describe('what a run spent before it was cut off (walk 20)', () => {
  it('sums the usage of every assistant message, names the model, and is null when none carried usage', () => {
    const messages = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 1000, cache_creation_input_tokens: 200, cache_read_input_tokens: 5000, output_tokens: 300 } } },
      { type: 'user', message: { content: [] } },
      { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 6000, output_tokens: 90 } } },
    ];

    assert.deepEqual(usageFromMessages(messages), { model: 'claude-opus-5-5', inputTokens: 12210, outputTokens: 390, cacheReadTokens: 11000, cacheWriteTokens: 200 });
    assert.equal(usageFromMessages([{ type: 'system' }]), null);
    assert.equal(usageFromMessages(undefined), null);
  });
});
