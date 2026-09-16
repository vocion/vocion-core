import type { RecordType } from '@/services/chat/pageContext';
import { describe, expect, it } from 'vitest';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { evidenceRef, looksLikeId } from './evidenceRef';
import { parsePreviewKey, previewKey } from './types';

/** Fixture citations only — every id, address and title here is invented. */

function isType(s: string): s is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(s);
}

describe('evidenceRef', () => {
  it('never lets a raw id be the whole label', () => {
    const item = evidenceRef('granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f');

    expect(item.label).toBe('Granola meeting');
    expect(item.label).not.toContain('9f1c2d3e');
    // The handle is not lost — it is what the preview resolves.
    expect(item.ref.id).toBe('granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f');
  });

  it('keeps a tail a person actually wrote', () => {
    expect(evidenceRef('zoom:Platform kickoff 2026-01-08').label).toBe('Platform kickoff 2026-01-08');
    expect(evidenceRef('gmail:Re: renewal paperwork').label).toBe('Re: renewal paperwork');
  });

  it.each([
    ['granola:abc', 'Granola', 'document'],
    ['zoom:abc', 'Zoom', 'document'],
    ['gmail:abc', 'Gmail', 'document'],
    ['docuseal:abc', 'DocuSeal', 'document'],
    ['deals:4021', 'HubSpot', 'deal'],
    ['contacts:5510', 'HubSpot', 'object'],
    ['companies:88', 'HubSpot', 'object'],
    ['hubspot:deals:4021', 'HubSpot', 'deal'],
  ])('%s is a %s reference of type %s', (source, sourceLabel, type) => {
    const item = evidenceRef(source);

    expect(item.sourceLabel).toBe(sourceLabel);
    expect(item.ref.type).toBe(type);
  });

  it('reads a bare URL as its host and path', () => {
    const item = evidenceRef('https://www.example.test/reports/q1/');

    expect(item.label).toBe('example.test/reports/q1');
    expect(item.sourceLabel).toBe('Link');
    expect(item.ref.type).toBe('page');
  });

  it('shows an unknown prefix as written rather than swallowing it', () => {
    const item = evidenceRef('ledger:2026-01-08 close');

    expect(item.sourceLabel).toBe('Ledger');
    expect(item.label).toBe('2026-01-08 close');
  });

  it('keeps a citation with no prefix intact', () => {
    const item = evidenceRef('Told to us on the kickoff call');

    expect(item.label).toBe('Told to us on the kickoff call');
    expect(item.raw).toBe('Told to us on the kickoff call');
  });

  it('round-trips every reference through the URL param', () => {
    for (const source of ['granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', 'gmail:Re: renewal paperwork', 'deals:4021', 'https://example.test/a?b=c']) {
      const { ref } = evidenceRef(source);
      const param = new URLSearchParams({ preview: previewKey(ref) }).toString();
      const back = parsePreviewKey(new URLSearchParams(param).get('preview'), isType);

      expect(back).toEqual({ type: ref.type, id: ref.id });
    }
  });

  it('closes rather than throws on a hand-edited param', () => {
    expect(parsePreviewKey('nonsense', isType)).toBeNull();
    expect(parsePreviewKey('document:', isType)).toBeNull();
    expect(parsePreviewKey(null, isType)).toBeNull();
  });
});

describe('looksLikeId', () => {
  it.each(['9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', '4021', '18c4f0a9b7d3e2f1'])('%s is a handle', (s) => {
    expect(looksLikeId(s)).toBe(true);
  });

  it.each(['Platform kickoff', 'Re: renewal paperwork', 'Q1 plan'])('%s is a name', (s) => {
    expect(looksLikeId(s)).toBe(false);
  });
});
