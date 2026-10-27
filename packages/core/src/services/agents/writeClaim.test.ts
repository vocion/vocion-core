import { describe, expect, it } from 'vitest';
import { isWriteTool, writeLanded } from './writeClaim';

describe('which tools write', () => {
  it('knows a write from a read by its verb', () => {
    for (const t of ['recommend_action', 'update_object', 'file_ask', 'write_wiki_page', 'create_artifact', 'save_lead_brief', 'propose_action', 'seo_save_draft', 'seo_plan_batch', 'seo_record_feedback']) {
      expect(isWriteTool(t)).toBe(true);
    }
    for (const t of ['lookup_objects', 'read_object', 'list_recent_runs', 'search_knowledge', 'get_briefing', 'verify_document', 'read_document', 'render_table', 'seo_next_pages']) {
      expect(isWriteTool(t)).toBe(false);
    }
  });

  it('a refused card or a failed call is not a write', () => {
    expect(writeLanded({ tool: 'recommend_action', output: '{"ok":false,"error":"No registered action"}' })).toBe(false);
    expect(writeLanded({ tool: 'update_object', output: 'Error: no such record' })).toBe(false);
    expect(writeLanded({ tool: 'seo_save_draft', output: 'Not saved: page #7 "trail shoes" is not released' })).toBe(false);
    expect(writeLanded({ tool: 'recommend_action', output: 'Surfaced a one-tap recommendation to the user: "File P1"' })).toBe(true);
  });
});
