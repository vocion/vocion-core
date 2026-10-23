import { describe, expect, it } from 'vitest';
import { presenterChannel, presenterNotesHtml } from './presenterNotes';
import { conflictLines, decodeAdvice, downloadName, exportFormats, exportHref, importAccept, reportSummary } from './transfer';

describe('download', () => {
  it('offers the PDF first, then the kind\'s editable file, through the export route', () => {
    expect(exportFormats('deck')).toEqual(['pdf', 'pptx']);
    expect(exportFormats('document')).toEqual(['pdf', 'docx']);
    expect(exportHref(41, 'pptx')).toBe('/api/deliverables/41/export?format=pptx');
    expect(importAccept('deck')).toContain('.pptx');
    expect(importAccept('document')).toContain('.docx');
  });

  it('reads the gate\'s advice as one decoded line, and none as none', () => {
    expect(decodeAdvice(encodeURIComponent('Slide 3 still says [$__] — fill the price before it goes out.'))).toBe('Slide 3 still says [$__] — fill the price before it goes out.');
    expect(decodeAdvice(null)).toBeNull();
    expect(decodeAdvice('  ')).toBeNull();
    // Not encoded after all: shown as sent rather than dropped.
    expect(decodeAdvice('100% sure')).toBe('100% sure');
  });

  it('saves under the server\'s filename, else the title', () => {
    expect(downloadName('attachment; filename="Kestrel Capital - concept.pptx"', 'x', 'pptx')).toBe('Kestrel Capital - concept.pptx');
    expect(downloadName('attachment; filename*=UTF-8\'\'Northwind%20%E2%80%94%20scope.docx', 'x', 'docx')).toBe('Northwind — scope.docx');
    expect(downloadName(null, 'Larkfield Systems / concept', 'pdf')).toBe('Larkfield Systems concept.pdf');
  });
});

describe('the upload report, in plain words', () => {
  it('counts a deck\'s slides by what happened and selects the first that changed', () => {
    const report = [
      ...Array.from({ length: 12 }, (_, i) => ({ slideId: `s${i}`, status: 'kept' as const })),
      { slideId: 'pricing', status: 'text-edited' as const },
      { slideId: 'team', status: 'text-edited' as const },
      { slideId: 'old', status: 'removed' as const },
      { slideId: 'new', status: 'added' as const },
    ];
    const s = reportSummary('deck', report);

    expect(s.counts).toEqual([{ key: 'kept', count: 12 }, { key: 'textEdited', count: 2 }, { key: 'added', count: 1 }, { key: 'removed', count: 1 }]);
    expect(s.firstChanged).toBe('pricing');
  });

  it('says a document\'s kept, edited and unplaced paragraphs and selects the first edited sheet', () => {
    const s = reportSummary('document', { kept: 40, edited: [{ sheet: 3, path: 'p2', before: 'a', after: 'b' }], unplaced: ['A stray paragraph'] });

    expect(s.counts).toEqual([{ key: 'kept', count: 40 }, { key: 'edited', count: 1 }, { key: 'unplaced', count: 1 }]);
    expect(s.firstChanged).toBe('3');
  });

  it('turns a stale upload\'s diff into the lines a person reads', () => {
    expect(conflictLines('~ Slide 2 [plan] (The plan): "Three" → "Two"\n+ Slide 3 [team] added\n')).toEqual(['~ Slide 2 [plan] (The plan): "Three" → "Two"', '+ Slide 3 [team] added']);
    expect(conflictLines({ unit: 'slide', added: [{ key: 'team', n: 3, label: 'Team' }], removed: [], moved: [], textChanged: [], notesChanged: [], restyled: [] })).toEqual(['+ Slide 3 [team] (Team) added']);
    expect(conflictLines(undefined)).toEqual([]);
  });
});

describe('the presenter notes window', () => {
  it('is one self-contained page that listens on the deck\'s channel and escapes what it is given', () => {
    const html = presenterNotesHtml(presenterChannel(7), {
      title: 'Notes · <Kestrel>',
      heading: 'Kestrel Capital',
      noNotes: 'No notes.',
      next: 'Next slide',
      end: 'End',
      previous: 'Previous',
      forward: 'Next',
      waiting: 'Waiting…',
      ended: 'Ended.',
    });

    expect(html).toContain('new BroadcastChannel("vocion-present:7")');
    expect(html).toContain('<title>Notes · &lt;Kestrel&gt;</title>');
    expect(html).not.toContain('"Notes · <Kestrel>"');
    expect(html).toContain('{type:\'hello\'}');
  });
});
