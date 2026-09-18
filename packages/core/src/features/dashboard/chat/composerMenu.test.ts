import type { ContextRef } from './types';
import { describe, expect, it } from 'vitest';
import { buildComposerMenu, selectableItems } from './composerMenu';

const WORDS = { commands: 'Commands', tag: 'Tag', attach: 'Add to this turn', attachFile: 'Attach a file', attachFileHint: 'Image, PDF or text', shortcuts: 'Shortcuts' };
const SHORTCUTS = [['Enter', 'Send'], ['?', 'These shortcuts']] as const;
const page: ContextRef = { type: 'page', id: 'p', label: 'This page' };
const artifact: ContextRef = { type: 'deliverable', id: 'artifact', label: 'A document' };
const base = { tagHint: (r: ContextRef) => r.type, shortcuts: SHORTCUTS, words: WORDS };

describe('the composer menu', () => {
  it('/ shows the commands that match, and nothing else', () => {
    const sections = buildComposerMenu({ ...base, mode: 'slash', query: 'ne', attachable: [page], canAttachFiles: true });

    expect(sections.map(s => s.id)).toEqual(['commands']);
    expect(sections[0]!.items.map(i => i.label)).toEqual(['/new']);
    expect(buildComposerMenu({ ...base, mode: 'slash', query: 'zzz' })).toEqual([]);
  });

  it('@ shows the resolved tags with what picking one does', () => {
    const sections = buildComposerMenu({ ...base, mode: 'tag', tagHits: [page, artifact] });

    expect(sections.map(s => s.id)).toEqual(['tags']);
    expect(sections[0]!.items.map(i => [i.label, 'hint' in i ? i.hint : null])).toEqual([['This page', 'page'], ['A document', 'deliverable']]);
  });

  it('(+) opens everything you can add — the file first, then the records, then the commands', () => {
    const sections = buildComposerMenu({ ...base, mode: 'plus', attachable: [page, artifact], canAttachFiles: true });

    expect(sections.map(s => s.id)).toEqual(['attach', 'commands']);
    expect(sections[0]!.items.map(i => i.kind)).toEqual(['file', 'tag', 'tag']);
    expect(sections[0]!.items.map(i => ('hint' in i ? i.hint : null))).toEqual(['Image, PDF or text', '@page', '@artifact']);
    expect(sections[1]!.items.map(i => i.label)).toEqual(['/new', '/history', '/search', '/help']);
    // No file support, no commands wired: only the records.
    expect(buildComposerMenu({ ...base, mode: 'plus', attachable: [page], canAttachFiles: false, commandsEnabled: false }).map(s => s.id)).toEqual(['attach']);
  });

  it('? is the shortcut reference, and the arrow keys skip it', () => {
    const sections = buildComposerMenu({ ...base, mode: 'help' });

    expect(sections.map(s => s.id)).toEqual(['shortcuts']);
    expect(sections[0]!.items.map(i => i.kind === 'shortcut' && i.keys)).toEqual(['Enter', '?']);
    expect(selectableItems(sections)).toEqual([]);
  });

  it('walks the selectable rows across sections in panel order', () => {
    const sections = buildComposerMenu({ ...base, mode: 'plus', attachable: [page], canAttachFiles: true });

    expect(selectableItems(sections).map(i => i.id)).toEqual(['attach-file', 'tag:page:p', 'command:new', 'command:history', 'command:search', 'command:help']);
  });
});
