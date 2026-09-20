import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { kindFromContentType, sniffImage, svgDimensions, svgIsInert, validateImageBytes } from './inspect';

const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]);
const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46]);
const gif = Buffer.from('GIF89a........', 'latin1');
const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1')]);
const svg = Buffer.from('<?xml version="1.0"?>\n<!-- Northwind -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><path d="M0 0"/></svg>');
const html = Buffer.from('<!DOCTYPE html>\n<html><body>Sign in</body></html>');

describe('sniffImage', () => {
  it('reads the magic bytes of each raster format', () => {
    expect(sniffImage(png)).toBe('png');
    expect(sniffImage(jpeg)).toBe('jpeg');
    expect(sniffImage(gif)).toBe('gif');
    expect(sniffImage(webp)).toBe('webp');
  });

  it('reads an SVG through its XML declaration and comments', () => {
    expect(sniffImage(svg)).toBe('svg');
  });

  it('refuses an HTML page, a text file and a truncated body', () => {
    expect(sniffImage(html)).toBeNull();
    expect(sniffImage(Buffer.from('not an image at all'))).toBeNull();
    expect(sniffImage(Buffer.from([0x89]))).toBeNull();
  });

  it('does not take <svg> further down a document as an SVG file', () => {
    expect(sniffImage(Buffer.from('<html><body><svg></svg></body></html>'))).toBeNull();
  });
});

describe('kindFromContentType', () => {
  it('normalises the spellings a server may use', () => {
    expect(kindFromContentType('image/jpg')).toBe('jpeg');
    expect(kindFromContentType('IMAGE/PNG; charset=binary')).toBe('png');
    expect(kindFromContentType('image/svg+xml')).toBe('svg');
    expect(kindFromContentType('image/vnd.microsoft.icon')).toBe('ico');
  });

  it('is null for anything that is not an image', () => {
    expect(kindFromContentType('text/html')).toBeNull();
    expect(kindFromContentType(null)).toBeNull();
    expect(kindFromContentType('application/octet-stream')).toBeNull();
  });
});

describe('validateImageBytes', () => {
  const maxBytes = 1024;

  it('accepts bytes that are an image and a header that agrees', () => {
    expect(validateImageBytes({ bytes: png, contentType: 'image/png', maxBytes })).toEqual({ ok: true, kind: 'png' });
  });

  it('believes the bytes, not the header, when they disagree', () => {
    // `.png` in the URL and `image/png` on the wire; a JPEG on the disk.
    expect(validateImageBytes({ bytes: jpeg, contentType: 'image/png', maxBytes })).toEqual({ ok: true, kind: 'jpeg' });
  });

  it('refuses an HTML page and says what to do about it', () => {
    const v = validateImageBytes({ bytes: html, contentType: 'text/html', maxBytes });

    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toContain('HTML page');
    expect(v.ok === false && v.reason).toContain('find the image\'s own URL');
  });

  it('refuses a non-image content type even when it cannot read the bytes', () => {
    const v = validateImageBytes({ bytes: Buffer.from('%PDF-1.7 ...'), contentType: 'application/pdf', maxBytes });

    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toContain('not an image');
  });

  it('refuses anything over the cap, in KB, before anything else', () => {
    const v = validateImageBytes({ bytes: Buffer.alloc(4096, 1), contentType: 'image/png', maxBytes });

    expect(v).toEqual({ ok: false, reason: 'it is 4 KB, over the 1 KB cap. Ask for a smaller version of the image.' });
  });

  it('refuses an empty body', () => {
    expect(validateImageBytes({ bytes: Buffer.alloc(0), maxBytes })).toEqual({ ok: false, reason: 'the response was empty.' });
  });
});

describe('svg', () => {
  it('takes the size from width/height, then from the viewBox', () => {
    expect(svgDimensions('<svg width="200px" height="50"></svg>')).toEqual({ width: 200, height: 50 });
    expect(svgDimensions(svg.toString())).toEqual({ width: 240, height: 60 });
    expect(svgDimensions('<svg width="100%"></svg>')).toBeNull();
  });

  it('refuses an SVG that carries script or a handler', () => {
    expect(svgIsInert(svg.toString())).toBe(true);
    expect(svgIsInert('<svg><script>fetch("/x")</script></svg>')).toBe(false);
    expect(svgIsInert('<svg onload="x()"></svg>')).toBe(false);
    expect(svgIsInert('<svg><a href="javascript:x()"></a></svg>')).toBe(false);
  });
});
