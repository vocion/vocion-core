import { describe, expect, it } from 'vitest';
import { toolsMarker } from './historyTools';

describe('toolsMarker', () => {
  it('says which tools a past turn ran and what came back', () => {
    const runs = [
      { type: 'text', text: 'I\'ll pull the records.' },
      { type: 'tool', name: 'lookup_objects', input: { type_slug: 'request', limit: 25 }, output: '[{"id":41},{"id":42},{"id":43}]' },
      { type: 'tool', name: 'read_object', input: { id: 121 }, output: 'title: add send/share…' },
      { type: 'tool', name: 'search_knowledge', input: { query: 'mobile upload fails on cellular' }, output: '[1] **squatch-core#23**\n[2] **squatch-core#7**' },
    ];

    expect(toolsMarker(runs)).toBe('\n\n[Earlier in this turn you ran: lookup_objects{type_slug: request, limit: 25} → 3 rows; read_object{id: 121} → 22 chars; search_knowledge{query: mobile upload fails on cellular} → 2 results]');
  });

  it('is nothing for a turn that ran no tool, and never longer than a line', () => {
    expect(toolsMarker([{ type: 'text', text: 'Yes.' }])).toBe('');
    expect(toolsMarker(null)).toBe('');

    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'tool', name: `tool_${i}`, input: { q: 'x'.repeat(40) }, output: 'y'.repeat(100) }));

    expect(toolsMarker(many).length).toBeLessThanOrEqual(602);
    expect(toolsMarker(many).endsWith('…]')).toBe(true);
  });
});
