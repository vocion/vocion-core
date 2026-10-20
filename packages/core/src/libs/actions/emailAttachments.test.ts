import { describe, expect, it } from 'vitest';
import { describeAttachment, MAX_ATTACHMENT_BYTES, sizeLabel } from './emailAttachments';

const SHEETS = '<html><head><title>Monthly report</title></head><body><section class="sheet"><h1>One</h1></section><section class="sheet"><h2>Two</h2></section></body></html>';

describe('describeAttachment', () => {
  it('a document goes as its PDF, with its page count', () => {
    expect(describeAttachment({ artifactId: 7 }, { id: 7, kind: 'document', title: 'Monthly report', url: null, spec: { html: SHEETS } }))
      .toEqual({ artifactId: 7, title: 'Monthly report', href: '/dashboard/artifacts/7', meta: 'PDF · 2 pages' });
  });

  it('a file goes as stored, with its size', () => {
    expect(describeAttachment({ artifactId: 8 }, { id: 8, kind: 'file', title: 'Report.pdf', url: '/api/artifacts/org-ab12cd34ef56ab78/org-ab12cd34ef56ab78.pdf', spec: { filename: 'org-ab12cd34ef56ab78.pdf', bytes: 44_042, contentType: 'application/pdf' } }))
      .toEqual({ artifactId: 8, title: 'Report.pdf', href: '/dashboard/artifacts/8', meta: '43 KB' });
  });

  it('says why before approval when one cannot go: missing, too big, or not a file', () => {
    expect(describeAttachment({ artifactId: 9 }, null).problem).toMatch(/Not found/);
    expect(describeAttachment({ artifactId: 10 }, { id: 10, kind: 'file', title: 'Huge.zip', url: null, spec: { filename: 'org-1.zip', bytes: MAX_ATTACHMENT_BYTES + 1 } }).problem).toMatch(/Larger than/);
    expect(describeAttachment({ artifactId: 11 }, { id: 11, kind: 'chart', title: 'Margins', url: null, spec: {} }).problem).toMatch(/cannot be attached/);
    expect(describeAttachment({ artifactId: 12 }, { id: 12, kind: 'document', title: 'Empty', url: null, spec: { html: '' } }).problem).toMatch(/no content/);
  });

  it('reads sizes the way a person does', () => {
    expect(sizeLabel(512)).toBe('1 KB');
    expect(sizeLabel(1_258_291)).toBe('1.2 MB');
  });
});
