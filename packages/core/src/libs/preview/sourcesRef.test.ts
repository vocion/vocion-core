import { describe, expect, it } from 'vitest';
import { parseSourcesRefId, sourceRecordRef, sourcesMarkdown, sourcesPreviewRef } from './sourcesRef';

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

  it('resolves a source that names one of our own records, not a bare external link', () => {
    // A tracker record (lookup_objects) — object-<id>, source_type "tracker".
    expect(sourceRecordRef({ document_id: 'object-42', source_type: 'tracker' })).toEqual({ type: 'object', id: '42' });
    // A briefing (briefingCitation.ts) — briefing:<id>.
    expect(sourceRecordRef({ document_id: 'briefing:7', source_type: 'briefing' })).toEqual({ type: 'briefing', id: '7' });
    // A search_knowledge hit — the ingested mirror's own numeric row id, whatever the connector.
    expect(sourceRecordRef({ document_id: '913', source_type: 'granola' })).toEqual({ type: 'document', id: '913' });
    // A bare external hit with nothing ingested (this suite's own fixture): no ref.
    expect(sourceRecordRef({ document_id: 'd2', source_type: 'web' })).toBeNull();
  });

  it('links a tracker/briefing/document source into the SAME pane, resolved by ref — never the raw link', () => {
    const md = sourcesMarkdown([
      { document_id: 'object-42', semantic_identifier: 'Northwind Renewal', link: '/dashboard/objects/tracker/42', source_type: 'tracker', blurb: 'active', citationIndex: 1 },
      { document_id: 'briefing:7', semantic_identifier: 'Monday briefing', link: '/dashboard/briefings/7', source_type: 'briefing', blurb: 'Kestrel renews Friday.', citationIndex: 2 },
      { document_id: '913', semantic_identifier: 'Kestrel kickoff notes', link: 'https://notes.example/k1', source_type: 'granola', blurb: 'Upload fix ships Friday.', citationIndex: 3 },
    ]);

    expect(md).toBe([
      '[1] **[Northwind Renewal](?preview=object%3A42)**\n\n_tracker_\n\nactive',
      '[2] **[Monday briefing](?preview=briefing%3A7)**\n\n_briefing_\n\nKestrel renews Friday.',
      '[3] **[Kestrel kickoff notes](?preview=document%3A913)**\n\n_granola_\n\nUpload fix ships Friday.',
    ].join('\n\n---\n\n'));
  });

  it('reads as a compact row when a source has nothing beyond its title', () => {
    const md = sourcesMarkdown([
      { document_id: 'object-99', semantic_identifier: 'Bare tracker row', link: '', source_type: 'tracker', blurb: '' },
    ]);

    expect(md).toBe('**[Bare tracker row](?preview=object%3A99)**\n\n_tracker_');
  });
});
