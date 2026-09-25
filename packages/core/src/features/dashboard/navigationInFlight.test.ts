import { afterEach, describe, expect, it } from 'vitest';
import { beginNavigation, endNavigation, isInAppNavigation, navigationPending, subscribeNavigation } from './navigationInFlight';

/**
 * The rule for "a navigation is in flight" (backlog 013), as a rule.
 */

const HERE = { origin: 'https://app.example', pathname: '/w/northwind/dashboard/p/work', search: '' };
const plainClick = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, defaultPrevented: false };

function anchor(href: string, over: { target?: string; download?: boolean } = {}) {
  return { href, target: over.target ?? '', hasAttribute: (name: string) => name === 'download' && over.download === true };
}

afterEach(() => {
  endNavigation();
});

describe('isInAppNavigation — which clicks the bar starts for', () => {
  it('starts for a plain click on another page of this app', () => {
    expect(isInAppNavigation(anchor('https://app.example/w/northwind/dashboard/p/work/12'), plainClick, HERE)).toBe(true);
    expect(isInAppNavigation(anchor('/dashboard/chat'), plainClick, HERE)).toBe(true);
    // A different query on the same path is a new page too (a filter, a tab).
    expect(isInAppNavigation(anchor('/w/northwind/dashboard/p/work?group=doing'), plainClick, HERE)).toBe(true);
  });

  it('does not start for a new tab, a download, another origin, or the page it is on', () => {
    expect(isInAppNavigation(anchor('/dashboard/chat'), { ...plainClick, metaKey: true }, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('/dashboard/chat'), { ...plainClick, button: 1 }, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('/dashboard/chat', { target: '_blank' }), plainClick, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('/api/artifacts/4/export', { download: true }), plainClick, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('https://docs.example/guide'), plainClick, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('/w/northwind/dashboard/p/work'), plainClick, HERE)).toBe(false);
    expect(isInAppNavigation(anchor('/w/northwind/dashboard/p/work#top'), plainClick, HERE)).toBe(false);
    // Something else already handled the click (a menu, a modal).
    expect(isInAppNavigation(anchor('/dashboard/chat'), { ...plainClick, defaultPrevented: true }, HERE)).toBe(false);
  });
});

describe('the in-flight record', () => {
  it('is pending from begin until end, and tells its subscribers', () => {
    const seen: boolean[] = [];
    const stop = subscribeNavigation(() => seen.push(navigationPending()));

    expect(navigationPending()).toBe(false);

    beginNavigation();
    beginNavigation();

    expect(navigationPending()).toBe(true);

    // One end clears every begin: the page landed, whatever started it.
    endNavigation();

    expect(navigationPending()).toBe(false);
    expect(seen).toEqual([true, true, false]);

    stop();
    beginNavigation();

    expect(seen).toEqual([true, true, false]);
  });

  it('ending with nothing in flight is not an event', () => {
    let calls = 0;
    const stop = subscribeNavigation(() => {
      calls += 1;
    });
    endNavigation();

    expect(calls).toBe(0);

    stop();
  });
});
