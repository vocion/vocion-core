import { describe, expect, it } from 'vitest';
import { isFullBleedPath, normalizePagePath, PAGE_READING_MAX_WIDTH, READING_WIDTH_CLASS } from './pageWidth';

/**
 * Which routes get the window and which keep the reading cap. The rule is a
 * pure function of the path precisely so this is answerable without a browser.
 */

describe('the reading-width cap', () => {
  it('is the default: an ordinary dashboard page keeps it', () => {
    for (const path of [
      '/dashboard',
      '/dashboard/chat',
      '/dashboard/artifacts',
      '/dashboard/inbox',
      '/dashboard/briefings',
      '/dashboard/teams',
      '/dashboard/profile',
    ]) {
      expect(isFullBleedPath(path)).toBe(false);
    }
  });

  it('is not dropped for a page merely because it is wide', () => {
    // A Detail with a right column and a List: both are read top to bottom,
    // and a 1900px line of prose is worse than an empty gutter.
    expect(isFullBleedPath('/dashboard/rooms/42')).toBe(false);
    expect(isFullBleedPath('/gtm/proposals')).toBe(false);
    expect(isFullBleedPath('/gtm/lead/abc')).toBe(false);
  });

  it('names one number in one place', () => {
    expect(READING_WIDTH_CLASS).toContain(`max-w-[${PAGE_READING_MAX_WIDTH}px]`);
  });
});

describe('the full-bleed surfaces', () => {
  it('opens the window for a conversation and for an artifact on its own page', () => {
    expect(isFullBleedPath('/dashboard/chat/132')).toBe(true);
    expect(isFullBleedPath('/dashboard/artifacts/251')).toBe(true);
  });

  it('leaves the document wrapper capped, because its sheet is a fixed size', () => {
    // `/…/open` renders the document's own HTML, whose sheet is 8.5in wide and
    // centred: width past the cap arrives as grey, not as document.
    expect(isFullBleedPath('/dashboard/artifacts/251/open')).toBe(false);
  });

  it('ignores the query, which is where the open artifact is named', () => {
    expect(isFullBleedPath('/dashboard/chat/132?artifact=251')).toBe(true);
  });

  it('holds through a locale prefix and a workspace-scoped link', () => {
    expect(isFullBleedPath('/fr/dashboard/chat/132')).toBe(true);
    expect(isFullBleedPath('/w/metacto-revenue/dashboard/chat/132')).toBe(true);
    expect(isFullBleedPath('/fr/w/metacto-revenue/dashboard/artifacts/251')).toBe(true);
  });

  it('is an exact match, never a prefix', () => {
    // A future child route is capped until it says otherwise.
    expect(isFullBleedPath('/dashboard/chat/132/settings')).toBe(false);
    expect(isFullBleedPath('/dashboard/chatter/132')).toBe(false);
    expect(isFullBleedPath('/dashboard/artifacts/new')).toBe(false);
  });
});

describe('normalizePagePath', () => {
  it('strips the locale, the workspace prefix, the query and the hash', () => {
    expect(normalizePagePath('/fr/w/kestrel/dashboard/chat/7?artifact=9#top')).toBe('/dashboard/chat/7');
  });

  it('survives a trailing slash and an empty path', () => {
    expect(normalizePagePath('/dashboard/chat/7/')).toBe('/dashboard/chat/7');
    expect(normalizePagePath('')).toBe('/');
    expect(normalizePagePath('/')).toBe('/');
  });

  it('leaves a bare `/w` alone rather than eating the next segment', () => {
    expect(normalizePagePath('/w')).toBe('/w');
  });
});
