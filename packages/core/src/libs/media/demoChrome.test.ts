import { describe, expect, it } from 'vitest';
import { DEMO_CHROME_SCRIPT } from './demoChrome';

/**
 * THE CHROME MUST PARSE (2026-10-05): a `\n` inside the template literal became a real line
 * break in a single-quoted string, every recorded demo loaded a script that threw at its first
 * token, and no cursor, ripple or outline was ever drawn — silently, because the calls into it are
 * decoration and swallow their errors. This is the check that would have caught it.
 */
describe('the demo chrome script', () => {
  it('parses as JavaScript', () => {
    // eslint-disable-next-line no-new-func -- parsing the injected script is the point of the test
    expect(() => new Function(DEMO_CHROME_SCRIPT)).not.toThrow();
  });

  it('installs the page API with every call the recorders make', () => {
    const calls: string[] = [];
    const el = () => ({ id: '', className: '', innerHTML: '', textContent: '', style: {} as Record<string, string>, classList: { add: (c: string) => calls.push(`add ${c}`), remove: () => {} }, offsetWidth: 0, remove: () => {} });
    const els: Record<string, ReturnType<typeof el>> = {};
    const doc = {
      body: { appendChild: (e: ReturnType<typeof el>) => {
        els[e.id] = e;
      } },
      head: { appendChild: () => {} },
      createElement: () => el(),
      getElementById: (id: string) => els[id] ?? null,
      addEventListener: () => {},
      activeElement: null,
      documentElement: {},
      querySelector: () => null,
    };
    const win: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func -- runs the injected script against a fake page
    new Function('window', 'document', 'setTimeout', DEMO_CHROME_SCRIPT)(win, doc, () => 0);
    const api = win.__vocionDemo as Record<string, (...a: unknown[]) => unknown>;

    expect(Object.keys(api).sort()).toEqual(['focusRect', 'keycap', 'moveTo', 'ripple', 'spotlight']);

    api.moveTo!(140, 210);
    api.spotlight!({ x: 100, y: 200, width: 80, height: 20 });

    expect(els['vocion-demo-cursor']!.style.transform).toBe('translate(140px,210px)');
    expect(els['vocion-demo-spot']!.style.opacity).toBe('1');
  });
});
