import { describe, expect, it } from 'vitest';
import { COMPOSER_CONTROL, COMPOSER_MAX_PX, COMPOSER_ROW, CONTROL_PX, LINE_INSET_PX, LINE_PX } from './composerBar';

describe('the composer bar\'s alignment rule', () => {
  it('one line of text is exactly one control tall', () => {
    expect(LINE_PX + LINE_INSET_PX * 2).toBe(CONTROL_PX);
  });

  it('the cap lands on a whole line, so it never leaves half a line above the controls', () => {
    expect((COMPOSER_MAX_PX - LINE_INSET_PX * 2) % LINE_PX).toBe(0);
  });

  it('the row bottom-aligns: the controls sit beside the line being typed', () => {
    expect(COMPOSER_ROW).toContain('items-end');
  });

  it('every control is the same 32px round target, with a focus ring', () => {
    expect(COMPOSER_CONTROL).toContain(`size-${CONTROL_PX / 4}`);
    expect(COMPOSER_CONTROL).toContain('rounded-full');
    expect(COMPOSER_CONTROL).toContain('focus-visible:ring-2');
  });

  it('a coarse pointer gets a 44px hit target without moving the box', () => {
    // -inset-1.5 is 6px on each side of a 32px control: 44px, the touch floor.
    expect(COMPOSER_CONTROL).toContain('pointer-coarse:before:-inset-1.5');
    expect(CONTROL_PX + 6 * 2).toBe(44);
    // …and the row opens its gap to 12px there so two 44px targets do not overlap.
    expect(COMPOSER_ROW).toContain('pointer-coarse:gap-3');
  });
});
