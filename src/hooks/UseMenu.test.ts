import { describe, expect, it } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import { useMenu } from './UseMenu';

describe('UseMenu', () => {
  describe('Render hook', () => {
    it('shouldn\'t show the menu by default', async () => {
      const { result } = await renderHook(() => useMenu());

      expect(result.current.showMenu).toBeFalsy();
    });

    it('should make the menu visible by toggling the menu', async () => {
      const { result, act } = await renderHook(() => useMenu());

      act(() => {
        result.current.handleToggleMenu();
      });

      expect(result.current.showMenu).toBeTruthy();
    });

    it('shouldn\'t make the menu visible after toggling and closing the menu', async () => {
      const { result, act } = await renderHook(() => useMenu());

      act(() => {
        result.current.handleClose();
      });

      expect(result.current.showMenu).toBeFalsy();
    });

    it('shouldn\'t make the menu visible after toggling the menu twice', async () => {
      const { result, act } = await renderHook(() => useMenu());

      act(() => {
        result.current.handleToggleMenu();
        result.current.handleToggleMenu();
      });

      expect(result.current.showMenu).toBeFalsy();
    });
  });
});
