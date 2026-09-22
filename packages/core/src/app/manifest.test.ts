import { describe, expect, it, vi } from 'vitest';

const envLabel = vi.fn();

vi.mock('@/libs/envLabel', () => ({ envLabel: () => envLabel() }));

const manifest = (await import('./manifest')).default;

describe('install to the home screen', () => {
  it('opens on the dashboard without browser chrome, under one stable id', () => {
    envLabel.mockReturnValue(null);
    const m = manifest();

    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/dashboard');
    // A reinstall replaces the same app rather than adding a second one.
    expect(m.id).toBe('/dashboard');
  });

  it('carries the environment in the name and the theme, so two installs are told apart', () => {
    envLabel.mockReturnValue('DEV');

    expect(manifest().name).toBe('Vocion DEV');
    expect(manifest().theme_color).toBe('#f59e0b');

    envLabel.mockReturnValue(null);

    expect(manifest().name).toBe('Vocion');
    expect(manifest().theme_color).toBe('#0b0b0f');
  });

  it('ships an icon big enough for a home screen', () => {
    envLabel.mockReturnValue(null);

    expect(manifest().icons?.some(i => i.sizes === '180x180')).toBe(true);
  });
});
