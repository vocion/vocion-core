import { describe, expect, it } from 'vitest';
import { announcementHtml, announcementImageFilename } from './announcementCopy';

describe('the announcement as rich text', () => {
  it('leads with the picture, then each paragraph, escaped', () => {
    expect(announcementHtml({ text: 'Uploads resume <now>.\n\nOn phones & tablets.', title: 'Relay "uploads"', imageSrc: 'data:image/png;base64,AAAA' })).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="Relay &quot;uploads&quot;" style="max-width:100%;height:auto"></p><p>Uploads resume &lt;now&gt;.</p><p>On phones &amp; tablets.</p>',
    );
  });

  it('is the words alone when there is no picture', () => {
    expect(announcementHtml({ text: 'Uploads resume.', title: 'Relay', imageSrc: null })).toBe('<p>Uploads resume.</p>');
  });

  it('names the download after the release', () => {
    expect(announcementImageFilename('Uploads that survive a bad connection', null)).toBe('uploads-that-survive-a-bad-connection.png');
    expect(announcementImageFilename('***', 'image/jpeg')).toBe('release.jpg');
  });
});
