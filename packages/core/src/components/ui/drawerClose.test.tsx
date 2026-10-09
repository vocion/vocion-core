import { describe, expect, it } from 'vitest';
import { clickClosesDrawer, DRAWER_CLOSE_ATTR } from './drawerClose';

function click(target: Element, mods: Partial<{ metaKey: boolean; button: number }> = {}) {
  return { target, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, ...mods };
}

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('clickClosesDrawer', () => {
  it('closes for a link, from anything inside it', () => {
    const host = html('<a href="/dashboard/workspaces"><span id="t">All workspaces</span></a>');

    expect(clickClosesDrawer(click(host.querySelector('#t')!))).toBe(true);
  });

  it('stays open for a new tab, a download, or a modified click', () => {
    const host = html('<a id="blank" href="https://docs.example" target="_blank">Docs</a><a id="dl" href="/f.csv" download>CSV</a><a id="plain" href="/x">X</a>');

    expect(clickClosesDrawer(click(host.querySelector('#blank')!))).toBe(false);
    expect(clickClosesDrawer(click(host.querySelector('#dl')!))).toBe(false);
    expect(clickClosesDrawer(click(host.querySelector('#plain')!, { metaKey: true }))).toBe(false);
  });

  it('stays open for the drawer\'s own buttons, and closes for a marked one', () => {
    const host = html(`<button id="pin">Pin</button><button id="switch" ${DRAWER_CLOSE_ATTR}><span id="inner">Northwind</span></button><button id="off" ${DRAWER_CLOSE_ATTR}="false">Current</button>`);

    expect(clickClosesDrawer(click(host.querySelector('#pin')!))).toBe(false);
    expect(clickClosesDrawer(click(host.querySelector('#inner')!))).toBe(true);
    expect(clickClosesDrawer(click(host.querySelector('#off')!))).toBe(false);
  });
});
