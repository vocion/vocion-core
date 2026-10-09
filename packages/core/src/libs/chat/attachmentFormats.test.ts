/**
 * What a person is told when a file cannot come along: one plain line, the
 * file's name or kind, the move that works — and never a MIME type (founder,
 * 2026-10-09: "Export-All-Leads.xlsx: … this is
 * application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").
 */
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ACCEPT, formatOf, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES, refusalFor } from './attachmentFormats';

const MB = 1024 * 1024;

describe('refusalFor — the error copy', () => {
  it('accepts the founder\'s lead export', () => {
    expect(refusalFor({ name: 'Export-All-Leads.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 2 * MB })).toBeNull();
  });

  it.each([
    ['Q4 board.key', 'Vocion can\'t read .key files yet. Export it as PDF or PowerPoint.'],
    ['Proposal.pages', 'Vocion can\'t read .pages files yet. Export it as PDF or Word.'],
    ['Budget.numbers', 'Vocion can\'t read .numbers files yet. Export it as Excel or CSV.'],
    ['Old contract.doc', 'Vocion can\'t read .doc files yet. Save it as .docx or PDF.'],
    ['Deck 2019.ppt', 'Vocion can\'t read .ppt files yet. Save it as .pptx or PDF.'],
    ['photos.zip', 'Vocion can\'t read .zip files yet. Unzip it and attach the files inside.'],
    ['IMG_0042.HEIC', 'Vocion can\'t read .heic files yet. Export it as JPEG or PNG.'],
    ['model.blend', 'Vocion can\'t read .blend files yet. Attach a PDF, an Office file, an image or a text file.'],
  ])('%s → %s', (name, copy) => {
    expect(refusalFor({ name, type: 'application/octet-stream', size: 1000 })).toBe(copy);
  });

  it('says the limit for an oversized file', () => {
    expect(refusalFor({ name: 'Export-All-Leads.xlsx', size: 31 * MB })).toBe('Export-All-Leads.xlsx is 31 MB. Files can be up to 25 MB.');
    expect(refusalFor({ name: 'Site walk.png', size: 7.2 * MB })).toBe('Site walk.png is 7.2 MB. Images can be up to 5 MB; a smaller export or a screenshot works.');
  });

  it('allows a file exactly at the limit', () => {
    expect(refusalFor({ name: 'big.pdf', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(refusalFor({ name: 'big.png', size: MAX_IMAGE_BYTES })).toBeNull();
  });

  it('names an empty file, and a file with no extension', () => {
    expect(refusalFor({ name: 'notes.txt', size: 0 })).toBe('notes.txt is empty.');
    expect(refusalFor({ name: 'README', size: 10 })).toBe('Vocion can\'t tell what kind of file “README” is. Add an extension like .pdf or .xlsx and try again.');
  });

  it('never puts a MIME type in front of a person', () => {
    for (const [name, type] of [
      ['a.key', 'application/x-iwork-keynote-sffkey'],
      ['a.bin', 'application/octet-stream'],
      ['a.mp4', 'video/mp4'],
      ['README', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.bogus'],
      ['huge.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ] as const) {
      const copy = refusalFor({ name, type, size: name === 'huge.xlsx' ? 40 * MB : 10 })!;

      expect(copy).toBeTruthy();
      expect(copy).not.toMatch(/\b(?:application|video|image|text)\/[\w.+-]+/);
    }
  });
});

describe('formatOf', () => {
  it('trusts the extension first — Windows calls a CSV an Excel file', () => {
    expect(formatOf({ name: 'leads.csv', type: 'application/vnd.ms-excel' })?.ext).toBe('csv');
  });

  it('falls back to the reported type when the name has no extension', () => {
    expect(formatOf({ name: 'pasted', type: 'image/png' })?.ext).toBe('png');
  });

  it('offers every format to the file picker', () => {
    for (const ext of ['xlsx', 'xls', 'xlsm', 'docx', 'pptx', 'odt', 'ods', 'tsv', 'xml', 'eml', 'msg', 'pdf', 'png']) {
      expect(ATTACHMENT_ACCEPT.split(',')).toContain(`.${ext}`);
    }
  });
});
