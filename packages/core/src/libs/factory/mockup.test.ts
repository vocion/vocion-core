/**
 * The mockup contract: the base is a real capture chosen by the platform, the
 * change is plain UI, and the ids on the record are the tool's alone.
 */
import type { MockupState, ShotCandidate } from './mockup';
import { describe, expect, it } from 'vitest';
import { guardVisuals, mockupHtml, mockupProblems, mockupRole, mockupVisuals, pickBase, showsAnError, visibleText } from './mockup';

const PNG = '/api/artifacts/org_x-aaaa/org_x-aaaa.png';

function shot(over: Partial<ShotCandidate> & { id: number }): ShotCandidate {
  return {
    title: 'Northwind files: a copy-link button on each row · desktop · before',
    kind: 'link',
    recordRole: 'qa-screenshot',
    url: PNG,
    spec: {},
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...over,
  };
}

describe('pickBase — the screen the mockup is drawn on', () => {
  it('takes the newest QA "before" capture, never an after, a report or a document', () => {
    const pick = pickBase([
      shot({ id: 1, createdAt: new Date('2026-09-20T10:00:00Z') }),
      shot({ id: 2, createdAt: new Date('2026-09-21T10:00:00Z') }),
      shot({ id: 3, title: 'Every row shows the control · desktop · after', createdAt: new Date('2026-09-22T10:00:00Z') }),
      shot({ id: 4, title: 'QA evidence for nw-t1', kind: 'markdown', recordRole: 'qa-report', url: null, createdAt: new Date('2026-09-23T10:00:00Z') }),
      shot({ id: 5, title: 'Row, AFTER, placement and states', kind: 'document', recordRole: 'document', url: null, createdAt: new Date('2026-09-24T10:00:00Z') }),
      // A "before" the worker wrote as markdown has no picture to draw on.
      shot({ id: 6, kind: 'markdown', url: null, createdAt: new Date('2026-09-25T10:00:00Z') }),
    ]);

    expect(pick.ok && pick.shot.id).toBe(2);
    expect(pick.ok && pick.viewport).toBe('desktop');
  });

  it('skips a capture the worker marked as an error state, and says so when that is all there is', () => {
    const broken = shot({ id: 7, spec: { description: 'Northwind files · desktop · before: at /library (app error state)' }, createdAt: new Date('2026-09-26T10:00:00Z') });

    expect(showsAnError(broken)).toBe(true);
    expect(pickBase([shot({ id: 1 }), broken]).ok && (pickBase([shot({ id: 1 }), broken]) as { shot: ShotCandidate }).shot.id).toBe(1);

    const none = pickBase([broken, { ...broken, id: 8 }]);

    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toMatch(/all 2 "before" captures .* show an error state/);
  });

  it('refuses to draw from memory when no capture exists', () => {
    const none = pickBase([shot({ id: 4, kind: 'markdown', recordRole: 'qa-report', url: null })]);

    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toMatch(/No screenshot of this surface exists yet.*never from memory/);
  });

  it('accepts a before-shot filed on the request, and prefers the viewport asked for', () => {
    const phone = shot({ id: 9, title: 'Row · mobile · before', createdAt: new Date('2026-09-19T10:00:00Z') });
    const filed = shot({ id: 10, title: 'Files today', recordRole: 'before-shot', createdAt: new Date('2026-09-18T10:00:00Z') });

    expect((pickBase([shot({ id: 1 }), phone], { viewport: 'mobile' }) as { shot: ShotCandidate }).shot.id).toBe(9);
    expect((pickBase([filed]) as { shot: ShotCandidate }).shot.id).toBe(10);
  });

  it('takes a named base only when it is itself a capture of the product', () => {
    const doc = shot({ id: 11, recordRole: 'document', kind: 'document', url: null });

    expect(pickBase([shot({ id: 1 }), doc], { baseId: 11 }).ok).toBe(false);
    expect((pickBase([shot({ id: 1 }), shot({ id: 12, title: 'Other flow · desktop · after' })], { baseId: 12 }) as { shot: ShotCandidate }).shot.id).toBe(12);
  });

  it('reads the picture from the url, the spec url or the spec href', () => {
    expect(pickBase([shot({ id: 13, url: '/api/artifacts/org_x-b', spec: { href: PNG } })]).ok).toBe(true);
  });
});

const SIZE = { width: 1280, height: 800 };
const BUTTON = '<button class="copy" aria-label="Copy link">Copy link</button>';

function state(over: Partial<MockupState> = {}): MockupState {
  return { state: 'Default', changes: [{ region: { x: 900, y: 200, width: 120, height: 32 }, html: BUTTON, css: '.copy{font:13px system-ui}' }], ...over };
}

describe('mockupProblems — a change, drawn as plain UI', () => {
  it('passes a button over one row, and states named once each', () => {
    expect(mockupProblems([state(), state({ state: 'Link copied', changes: [{ region: { x: 900, y: 200, width: 160, height: 32 }, html: '<span class="toast">✓ Link copied</span>' }] })], SIZE)).toEqual([]);
  });

  it('refuses the annotations the #224 documents were made of', () => {
    const notes = [
      '<div class="callout">Callout: the button sits here</div>',
      '<p>AFTER: copy-link on every row</p>',
      '<span>Rule — never opens the file</span>',
      '<span>→ new</span>',
    ];
    for (const html of notes) {
      const problems = mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 100, height: 40 }, html }] })], SIZE);

      expect(problems.join(' ')).toMatch(/note about the design, not part of the product/);
    }
  });

  it('lets the product use its own words: "after", "note" and "rule" inside real UI text', () => {
    expect(mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 200, height: 40 }, html: '<button>Add a note</button><small>Expires after 7 days</small>' }] })], SIZE)).toEqual([]);
  });

  it('refuses a paragraph, a redraw of the page, a region off the screen and markup a UI fragment never needs', () => {
    const long = `<p>${'Every row carries a copy control that places the share link on the clipboard. '.repeat(2)}</p>`;

    expect(mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 100, height: 40 }, html: long }] })], SIZE).join(' ')).toMatch(/characters of text/);
    expect(mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 1280, height: 800 }, html: BUTTON }] })], SIZE).join(' ')).toMatch(/cover 100% of the screen/);
    expect(mockupProblems([state({ changes: [{ region: { x: 1200, y: 10, width: 200, height: 40 }, html: BUTTON }] })], SIZE).join(' ')).toMatch(/not inside the 1280×800 screenshot/);
    expect(mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 100, height: 40 }, html: '<button onclick="x()">Copy</button>' }] })], SIZE).join(' ')).toMatch(/plain HTML and CSS only/);
    expect(mockupProblems([state({ changes: [{ region: { x: 0, y: 0, width: 100, height: 40 }, html: BUTTON, css: '.copy{background:url(https://cdn.example.test/x.png)}' }] })], SIZE).join(' ')).toMatch(/plain HTML and CSS only/);
  });

  it('refuses no state, too many states and two states with one name', () => {
    expect(mockupProblems([], SIZE)).toEqual(['Draw at least one state.']);
    expect(mockupProblems(Array.from({ length: 7 }, (_, i) => state({ state: `S${i}` })), SIZE).join(' ')).toMatch(/At most 6 images/);
    expect(mockupProblems([state(), state()], SIZE).join(' ')).toMatch(/two images are named "Default"/);
  });

  it('reads visible text without tags or styles', () => {
    expect(visibleText('<style>.a{}</style><button> Copy&nbsp;link </button>')).toBe('Copy link');
  });
});

describe('mockupHtml — the screenshot and the change, nothing else', () => {
  it('lays each change at its region over the base, with no caption, frame or title', () => {
    const html = mockupHtml('data:image/png;base64,AAAA', SIZE, state().changes);

    expect(html).toContain('left:900px;top:200px;width:120px;height:32px');
    expect(html).toContain('width:1280px;height:800px');
    expect(visibleText(html)).toBe('Copy link');
  });
});

describe('the visuals ids are the tool\'s', () => {
  const current = { surfaceUrl: 'https://app.example.test/files', beforeArtifactIds: [11], mockupArtifactIds: [21, 22], drawnArtifactId: 30 };

  it('refuses a hand-written screenshot or mockup list that differs from the record', () => {
    const out = guardVisuals(current, { beforeArtifactIds: [21, 22] });

    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/written by draw_mockup, never by hand/);
    expect(guardVisuals({}, { mockupArtifactIds: [5] }).ok).toBe(false);
  });

  it('carries every key a write left out, so setting the URL keeps the pictures', () => {
    const out = guardVisuals(current, { surfaceUrl: 'https://app.example.test/files?view=list', beforeArtifactIds: [11] });

    expect(out).toEqual({ ok: true, value: { ...current, surfaceUrl: 'https://app.example.test/files?view=list' } });
  });

  it('refuses clearing visuals whole while it carries tool-written ids', () => {
    expect(guardVisuals(current, null).ok).toBe(false);
    expect(guardVisuals({ surfaceUrl: 'x' }, null)).toEqual({ ok: true, value: null });
  });

  it('the tool writes the screenshot as before, the states as mockups, and drops a stale no-visual reason', () => {
    expect(mockupVisuals({ ...current, noVisualReason: '' }, { beforeId: 12, mockupIds: [41, 42] })).toEqual({
      surfaceUrl: 'https://app.example.test/files',
      beforeArtifactIds: [12],
      mockupArtifactIds: [41, 42],
      drawnArtifactId: 30,
    });
  });

  it('files each state under its own role, so a redraw is a new version', () => {
    expect(mockupRole('Link copied!')).toBe('mockup:link-copied');
    expect(mockupRole('  ')).toBe('mockup:default');
  });
});
