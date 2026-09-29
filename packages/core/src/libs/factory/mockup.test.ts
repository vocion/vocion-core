/**
 * The mockup contract: the base is a real capture chosen by the platform, the
 * change is plain UI, and the ids on the record are the tool's alone.
 */
import type { MockupState, ShotCandidate } from './mockup';
import { describe, expect, it } from 'vitest';
import { blocksHtml, guardVisuals, mockupHtml, mockupProblems, mockupTitle, mockupVisuals, pickBase, showsAnError, textRuns, visibleText } from './mockup';

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

  it('says plainly when no capture exists', () => {
    const none = pickBase([shot({ id: 4, kind: 'markdown', recordRole: 'qa-report', url: null })]);

    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toMatch(/No screenshot of this surface exists/);
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
    const html = mockupHtml('data:image/png;base64,AAAA', SIZE, state().changes!);

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

  it('without a screenshot it keeps only real captures on the before list, dropping a document typed there', () => {
    const legacy = { beforeArtifactIds: [90, 91, 11] };

    expect(mockupVisuals(legacy, { beforeId: null, mockupIds: [41], captureIds: new Set([11]) })).toEqual({ beforeArtifactIds: [11], mockupArtifactIds: [41] });
    expect(mockupVisuals(legacy, { beforeId: null, mockupIds: [41] })).toEqual({ mockupArtifactIds: [41] });
  });

  it('titles each image the way the feature page\'s mockups read, "Mockup: <request>"', () => {
    expect(mockupTitle('Open alerts', 'Default', 1)).toBe('Mockup: Open alerts');
    expect(mockupTitle('Open alerts', 'Link copied ', 2)).toBe('Mockup: Open alerts · Link copied');
  });
});

/** The #124-era shape: a card of rows with a chip and a button, the new control ringed. */
const CARD = `<div class="card"><div class="row"><b>Q3 board deck.pdf</b></div><div class="muted">Sent to 4 people · 3 opened</div>
<div class="row"><b>dana@kestrel.example</b><span class="chip">Opened 3×</span><span class="muted">last 10:42 today</span></div>
<div class="row"><b>li@fabrikam.example</b><span class="chip">Not opened yet</span><button class="btn" data-hint="1">Nudge</button></div></div>`;

function blocks(html: string, over: Partial<MockupState> = {}): MockupState {
  return { state: 'Default', html, css: '.card{background:#fff;border-radius:14px;padding:28px}', ...over };
}

describe('mockupProblems — UI blocks, with no screenshot', () => {
  it('passes the product\'s own card, rows and chips, with a ringed control and up to three short notes', () => {
    const noted = CARD
      .replace('data-hint="1"', 'data-hint="1" data-note="Resends the link with a short note"')
      .replace('<span class="chip">Opened 3×</span>', '<span class="chip" data-hint="2" data-note="Counts every open, bots excluded">Opened 3×</span>')
      .replace('<div class="muted">Sent to', '<div class="muted" data-hint="3" data-note="Updates within a minute, no reload">Sent to');

    expect(mockupProblems([blocks(CARD)], null)).toEqual([]);
    expect(mockupProblems([blocks(noted)], null)).toEqual([]);
  });

  it('refuses a written doc: a paragraph, a table, a heading about the design, an annotation class, a rule box', () => {
    const cases: Array<[string, RegExp]> = [
      [`${CARD}<p>Every recipient row carries a nudge control which resends the original share link to that person, and the sender sees when it went.</p>`, /is a paragraph/],
      [`<table><tr><td>State</td><td>Copy</td></tr></table>`, /a table, caption, quote or code block is a document/],
      [`<h2>Four states, and the words in each</h2>${CARD}`, /explains the design/],
      [`${CARD}<div class="callout">Sits beside the link</div>`, /classed as an annotation/],
      [`${CARD}<div class="rule-box">Never opens the file</div>`, /classed as an annotation/],
      [`${CARD}<span>AFTER: the nudge</span>`, /note about the design/],
    ];
    for (const [html, why] of cases) {
      expect(mockupProblems([blocks(html)], null).join(' ')).toMatch(why);
    }
  });

  it('refuses more than a few notes, a long note, and a note that restates the screen', () => {
    const many = Array.from({ length: 6 }, (_, i) => `<span class="chip" data-hint="${(i % 3) + 1}" data-note="Hint number ${i}">Chip ${i}</span>`).join('');

    expect(mockupProblems([blocks(many)], null).join(' ')).toMatch(/6 notes; at most 3/);
    expect(mockupProblems([blocks(CARD.replace('data-hint="1"', 'data-note="This button resends the original share link to the one person who has not yet opened it today"'))], null).join(' ')).toMatch(/is \d+ words; a note is one line of at most 15 words/);
    expect(mockupProblems([blocks(CARD.replace('data-hint="1"', 'data-note="Not opened yet"'))], null).join(' ')).toMatch(/says what the screen already shows/);
    expect(mockupProblems([blocks(CARD.replace('data-hint="1"', 'data-hint="new"'))], null).join(' ')).toMatch(/data-hint takes one digit/);
  });

  it('needs html or changes, and changes need a screenshot', () => {
    expect(mockupProblems([{ state: 'Default' }], null).join(' ')).toMatch(/either `html`.*not neither/);
    expect(mockupProblems([state()], null).join(' ')).toMatch(/no screenshot of this surface to lay changes over/);
  });

  it('draws the blocks centred on a quiet canvas the size of a desk, in the product\'s look, with the platform\'s hint', () => {
    const html = blocksHtml({ html: CARD }, { background: '#f1f5f9', ink: '#0f172a', accent: '#4f46e5', font: 'Inter, sans-serif' });

    expect(html).toContain('width:1440px;height:900px');
    expect(html).toContain('background:#f1f5f9');
    expect(html).toContain('[data-hint]::after{content:attr(data-hint)');
    expect(textRuns(html)).toEqual(textRuns(CARD));
    expect(blocksHtml({ html: CARD }, undefined, 'mobile')).toContain('width:430px;height:932px');
  });
});
