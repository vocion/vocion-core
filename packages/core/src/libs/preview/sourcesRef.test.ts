import { describe, expect, it } from 'vitest';
import { parseSourcesRefId, sourcesMarkdown, sourcesPreviewRef } from './sourcesRef';

describe('a turn\'s sources open in the one preview pane (Chris, 2026-09-29)', () => {
  it('addresses a conversation\'s sources, or one turn\'s, and reads the id back', () => {
    expect(sourcesPreviewRef(412)).toEqual({ type: 'conversation', id: '412.sources' });
    expect(sourcesPreviewRef(412, 9051)).toEqual({ type: 'conversation', id: '412.sources.9051' });
    expect(parseSourcesRefId('412.sources')).toEqual({ conversationId: 412, messageId: null });
    expect(parseSourcesRefId('412.sources.9051')).toEqual({ conversationId: 412, messageId: 9051 });
    // A plain conversation is not a sources view.
    expect(parseSourcesRefId('412')).toBeNull();
    expect(parseSourcesRefId('412.plan')).toBeNull();
  });

  it('lists each source once, numbered as cited, with its excerpt and a link out', () => {
    const md = sourcesMarkdown([
      { document_id: 'd1', semantic_identifier: 'Kestrel kickoff notes', link: 'https://notes.example/k1', source_type: 'granola', blurb: 'Upload fix ships Friday.', citationIndex: 1, updated_at: '2026-09-20T10:00:00Z' },
      { document_id: 'd1', semantic_identifier: 'Kestrel kickoff notes', link: 'https://notes.example/k1', source_type: 'granola', blurb: 'Upload fix ships Friday.', citationIndex: 1 },
      { document_id: 'd2', semantic_identifier: 'Northwind [draft] brief', link: '', source_type: 'web', blurb: 'Pricing page.' },
    ]);

    expect(md).toBe([
      '[1] **[Kestrel kickoff notes](https://notes.example/k1)**\n\n_granola · 2026-09-20_\n\nUpload fix ships Friday.',
      '**Northwind draft brief**\n\n_web_\n\nPricing page.',
    ].join('\n\n---\n\n'));
  });
});
