import { describe, expect, it } from 'vitest';
import { isWriteTool, wroteInTurn } from './writeClaim';

describe('which tools write', () => {
  it('knows a write from a read by its verb', () => {
    for (const t of ['recommend_action', 'update_object', 'file_ask', 'write_wiki_page', 'create_artifact', 'save_lead_brief', 'propose_action']) {
      expect(isWriteTool(t)).toBe(true);
    }
    for (const t of ['lookup_objects', 'read_object', 'list_recent_runs', 'search_knowledge', 'get_briefing', 'verify_document', 'read_document', 'render_table']) {
      expect(isWriteTool(t)).toBe(false);
    }
  });

  it('a refused card or a failed call is not a write', () => {
    expect(wroteInTurn([{ tool: 'recommend_action', output: '{"ok":false,"error":"No registered action"}' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'update_object', output: 'Error: no such record' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'recommend_action', output: 'Surfaced a one-tap recommendation to the user: "File P1"' }])).toBe(true);
  });
});

describe('a write that said it did not write (conversation 382)', () => {
  it('is not counted as a write', () => {
    expect(wroteInTurn([{ tool: 'withdraw_proposal', output: 'Proposal #5232 is not yours to withdraw.' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'recommend_action', output: 'not put up: Object type "request" declares no field "scope".' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'update_object', output: 'Received tool input did not match expected schema' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'update_object', output: '' }])).toBe(false);
    expect(wroteInTurn([{ tool: 'withdraw_proposal', output: 'Withdrew proposal #5232.' }])).toBe(true);
  });
});
