import { describe, expect, it } from 'vitest';
import { artifactHref, contentTypeForExt, parseArtifactFilename, servedArtifactUrl } from './url';

describe('artifact urls', () => {
  it('rewrites legacy public paths to the authenticated route and leaves others alone', () => {
    expect(artifactHref('/artifacts/org1-abc123.csv')).toBe('/api/artifacts/org1-abc123/org1-abc123.csv');
    expect(artifactHref('/api/artifacts/org1-abc123/org1-abc123.csv')).toBe('/api/artifacts/org1-abc123/org1-abc123.csv');
    expect(artifactHref('https://example.com/x.pdf')).toBe('https://example.com/x.pdf');
    expect(artifactHref(null)).toBe('#');
  });

  it('honours an override base as a flat static path', () => {
    expect(servedArtifactUrl('org1-abc.svg', 'https://cdn.example.com/a/')).toBe('https://cdn.example.com/a/org1-abc.svg');
  });

  it('parses ids and rejects traversal', () => {
    expect(parseArtifactFilename('org1-abc.svg')).toEqual({ id: 'org1-abc', ext: 'svg' });
    expect(parseArtifactFilename('../x.svg')).toBeNull();
    expect(contentTypeForExt('md')).toMatch(/markdown/);
    expect(contentTypeForExt('bin')).toBe('application/octet-stream');
  });
});
