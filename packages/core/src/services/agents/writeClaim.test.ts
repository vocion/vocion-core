import { describe, expect, it } from 'vitest';
import { isWriteTool, unbackedWriteNotice, writeClaim, wroteInTurn } from './writeClaim';

const reads = [
  { tool: 'lookup_objects', output: 'request #126 Retry uploads — state new' },
  { tool: 'read_object', output: '{"id":126}' },
];

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

describe('what counts as a claim', () => {
  it('catches the shapes real turns used', () => {
    // Finding 23, word for word.
    expect(writeClaim('Scoped.\n\n**Filed:** Request recorded for Send. Architecture plan queued.')).not.toBeNull();
    expect(writeClaim('Filed: request for StampSend MCP.')).not.toBeNull();
    expect(writeClaim('I\'ve filed the request and queued the plan.')).not.toBeNull();
    expect(writeClaim('I created request #130.')).not.toBeNull();
    expect(writeClaim('- **Recorded** — the incident, P1.')).not.toBeNull();
  });

  it('leaves intent, negation and plain history alone', () => {
    expect(writeClaim('I\'ll file it once you approve.')).toBeNull();
    expect(writeClaim('I have not filed anything yet.')).toBeNull();
    expect(writeClaim('Nothing is filed for Send this week.')).toBeNull();
    expect(writeClaim('The recorded demo from Tuesday covers this.')).toBeNull();
    expect(writeClaim('Tap the card to file it.')).toBeNull();
  });
});

describe('the notice', () => {
  it('fires on a claim with only reads behind it', () => {
    expect(unbackedWriteNotice('**Filed:** Request recorded for Send.', reads)).toMatch(/Nothing was saved in this turn/);
    expect(unbackedWriteNotice('**Filed:** Request recorded for Send.', [])).not.toBeNull();
  });

  it('stays silent when a write ran or nothing was claimed', () => {
    expect(unbackedWriteNotice('**Filed:** Request #130.', [...reads, { tool: 'update_object', output: '{"ok":true,"id":130}' }])).toBeNull();
    expect(unbackedWriteNotice('Request #126 is in building.', reads)).toBeNull();
  });
});
