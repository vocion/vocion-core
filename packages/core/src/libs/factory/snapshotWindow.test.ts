import { describe, expect, it } from 'vitest';
import { snapshotWindow } from './snapshotWindow';

const tree = Array.from({ length: 400 }, (_, i) => `- ${i === 300 ? 'heading "Expiry" [ref=e301]' : `text "row ${i}" [ref=e${i}]`}`).join('\n');

describe('the part of a long page a snapshot shows (walk 22, FE-226)', () => {
  it('shows the top when nothing is asked for, and says how much is below', () => {
    const w = snapshotWindow(tree, 2_000);

    expect(w.found).toBe(false);
    expect(w.text.startsWith('- text "row 0"')).toBe(true);
    expect(w.text).toMatch(/\[truncated: \d+ more characters of the page were not shown\]$/);
  });

  it('cuts the window around the words asked for, on whole lines, saying what was left out above and below', () => {
    const w = snapshotWindow(tree, 2_000, 'expiry');

    expect(w.found).toBe(true);
    expect(w.text).toContain('heading "Expiry" [ref=e301]');
    expect(w.text).toMatch(/^\[\d+ characters above "expiry" not shown\]\n- text/);
    expect(w.text).toMatch(/\n\[\d+ characters below not shown\]$/);
    expect(w.text.length).toBeLessThanOrEqual(2_000 + 120);
  });

  it('says when the words are not on the page, and shows the top', () => {
    const w = snapshotWindow(tree, 2_000, 'Billing');

    expect(w.found).toBe(false);
    expect(w.text).toContain('"Billing" is not on this page');
  });

  it('leaves a short page whole', () => {
    expect(snapshotWindow('- button "Save" [ref=e1]', 2_000, 'save')).toEqual({ text: '- button "Save" [ref=e1]', found: true });
  });
});
