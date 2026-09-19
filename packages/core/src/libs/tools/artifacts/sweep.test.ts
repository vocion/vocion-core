import { describe, expect, it } from 'vitest';
import { artifactFilenameFromUrl, filesInSpec, planArtifactSweep } from './sweep';

/**
 * The sweep's contract is what it REFUSES to remove. Every test here is a way
 * of not deleting a person's rendered deliverable.
 *
 * Fixtures are fictional — Kestrel Capital, Northwind Logistics.
 */

const ORG = 'org_kestrel';
const png = (n: string) => `/api/artifacts/${ORG}-${n}/${ORG}-${n}.png`;
const file = (n: string) => `${ORG}-${n}.png`;

function documentSpec(sheets: string[], pdf?: string) {
  return {
    html: '<!doctype html><article class="sheet"></article>',
    verification: {
      at: '2026-09-19T10:00:00.000Z',
      sheets: sheets.map((n, i) => ({ n: i + 1, footerY: 984, overflowPx: 0, clipped: [], image: png(n) })),
      footerAligned: true,
      pdfPages: sheets.length,
      ...(pdf ? { pdf: `/api/artifacts/${ORG}-${pdf}/${ORG}-${pdf}.pdf` } : {}),
      unresolvedAssets: [],
      issues: [],
      ok: true,
    },
  };
}

describe('reading a stored URL back to a file', () => {
  it('accepts both shapes live rows carry and nothing else', () => {
    expect(artifactFilenameFromUrl(png('aaaa'))).toBe(file('aaaa'));
    expect(artifactFilenameFromUrl(`/artifacts/${ORG}-bbbb.pdf`)).toBe(`${ORG}-bbbb.pdf`);
    expect(artifactFilenameFromUrl('/dashboard/artifacts/41')).toBeNull();
    expect(artifactFilenameFromUrl('https://example.com/deck.pdf')).toBeNull();
    expect(artifactFilenameFromUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(artifactFilenameFromUrl('/api/artifacts/x/../../etc/passwd')).toBeNull();
    expect(artifactFilenameFromUrl(undefined)).toBeNull();
  });
});

describe('what a version says it holds', () => {
  it('reads the sheet images and the PDF off a document verification', () => {
    expect(filesInSpec(documentSpec(['s1', 's2'], 'pdf1')).sort()).toEqual([file('s1'), file('s2'), `${ORG}-pdf1.pdf`].sort());
  });

  it('reads a file artifact from its spec url and its row url', () => {
    expect(filesInSpec({ filename: 'x.pdf', url: `/api/artifacts/${ORG}-q/${ORG}-q.pdf` })).toEqual([`${ORG}-q.pdf`]);
    expect(filesInSpec({}, png('r'))).toEqual([file('r')]);
  });

  it('never reads prose: a markdown body naming a stored file is not a reference it may act on', () => {
    // `generate_image` writes a PNG and hands the model a markdown link to it;
    // no row ever points at that file. Walking prose here would make the sweep
    // look authoritative about files it cannot see all the references to.
    expect(filesInSpec({ md: `An image: ![chart](${png('zzzz')})` })).toEqual([]);
    expect(filesInSpec({ href: png('yyyy') })).toEqual([]);
  });
});

describe('planning a sweep', () => {
  it('keeps every file the current version holds', () => {
    const plan = planArtifactSweep([
      { artifactId: 1, version: 3, current: true, files: [file('c1'), file('c2')] },
      { artifactId: 1, version: 2, current: false, files: [file('b1')] },
      { artifactId: 1, version: 1, current: false, files: [file('a1')] },
    ], { keepSuperseded: 0 });

    expect(plan.removable.map(r => r.filename)).toEqual([file('b1'), file('a1')]);
    expect(plan.keptCurrent).toBe(2);
  });

  it('keeps the newest N superseded versions', () => {
    const versions = [
      { artifactId: 1, version: 4, current: true, files: [file('d')] },
      { artifactId: 1, version: 3, current: false, files: [file('c')] },
      { artifactId: 1, version: 2, current: false, files: [file('b')] },
      { artifactId: 1, version: 1, current: false, files: [file('a')] },
    ];

    expect(planArtifactSweep(versions, { keepSuperseded: 2 }).removable.map(r => r.filename)).toEqual([file('a')]);
    expect(planArtifactSweep(versions, { keepSuperseded: 5 }).removable).toEqual([]);
    expect(planArtifactSweep(versions, { keepSuperseded: 2 }).keptRecent).toBe(2);
  });

  it('never removes a file a surviving version shares — the content-addressed trap', () => {
    // Sheet 1 did not change between v1 and v3, so all three versions name
    // ONE file. Per-version bookkeeping would delete the open document's
    // cover sheet.
    const plan = planArtifactSweep([
      { artifactId: 1, version: 3, current: true, files: [file('cover'), file('new-body')] },
      { artifactId: 1, version: 2, current: false, files: [file('cover'), file('old-body')] },
      { artifactId: 1, version: 1, current: false, files: [file('cover'), file('older-body')] },
    ], { keepSuperseded: 0 });

    expect(plan.removable.map(r => r.filename).sort()).toEqual([file('old-body'), file('older-body')].sort());
    expect(plan.removable.some(r => r.filename === file('cover'))).toBe(false);
    expect(plan.keptShared).toBe(1);
  });

  it('takes the whole workspace into account: another artifact still pointing at a file keeps it', () => {
    // The exported PDF is a `file` artifact of its own; the document version
    // that printed it is long superseded.
    const plan = planArtifactSweep([
      { artifactId: 1, version: 9, current: true, files: [file('head')] },
      { artifactId: 1, version: 2, current: false, files: [`${ORG}-print.pdf`] },
      { artifactId: 2, version: 1, current: true, files: [`${ORG}-print.pdf`] },
    ], { keepSuperseded: 0 });

    expect(plan.removable).toEqual([]);
    expect(plan.keptShared).toBe(1);
  });

  it('reports each removable file once, attributed to the newest version that held it', () => {
    const plan = planArtifactSweep([
      { artifactId: 1, version: 4, current: true, files: [file('head')] },
      { artifactId: 1, version: 3, current: false, files: [file('dup')] },
      { artifactId: 1, version: 2, current: false, files: [file('dup')] },
    ], { keepSuperseded: 0 });

    expect(plan.removable).toEqual([{ filename: file('dup'), artifactId: 1, version: 3 }]);
  });

  it('an artifact with only a current version frees nothing', () => {
    expect(planArtifactSweep([{ artifactId: 7, version: 1, current: true, files: [file('only')] }], { keepSuperseded: 0 }).removable).toEqual([]);
    expect(planArtifactSweep([], { keepSuperseded: 3 })).toEqual({ removable: [], keptCurrent: 0, keptRecent: 0, keptShared: 0 });
  });

  it('a negative or fractional keep is read as the nearest safe whole number', () => {
    const versions = [
      { artifactId: 1, version: 2, current: true, files: [file('head')] },
      { artifactId: 1, version: 1, current: false, files: [file('old')] },
    ];

    expect(planArtifactSweep(versions, { keepSuperseded: -4 }).removable).toHaveLength(1);
    expect(planArtifactSweep(versions, { keepSuperseded: 1.9 }).removable).toHaveLength(0);
  });
});
