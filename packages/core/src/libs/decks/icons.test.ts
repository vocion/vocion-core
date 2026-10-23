import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconSvg, iconTable, resolveIcon } from './icons';

const REQUIRED = [
  'Check',
  'CheckCircle',
  'Book',
  'Lock',
  'Users',
  'Verified',
  'Chart',
  'Clock',
  'Globe',
  'Chat',
  'Star',
  'PaperPlane',
  'Link',
  'Lightning',
  'Cloud',
  'Wrench',
  'Search',
  'Lightbulb',
  'GraduationCap',
  'Database',
  'Code',
  'Activity',
];

const BUSINESS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Calendar', 'Mail', 'File', 'Folder', 'Shield', 'Settings', 'Target', 'TrendingUp', 'Dollar', 'Building', 'Truck', 'Phone', 'Map', 'Flag', 'Sparkle', 'Eye', 'Heart', 'Plus', 'Minus', 'X', 'Info', 'Warning', 'Gauge', 'Layers', 'Cpu', 'Server', 'Robot', 'Bot', 'Inbox', 'Send', 'Trophy', 'Rocket', 'Handshake', 'Briefcase', 'Receipt', 'Calculator', 'Clipboard', 'ListChecks'];

describe('the icon map', () => {
  it('covers every icon the deck format promises', () => {
    const missing = [...REQUIRED, ...BUSINESS].filter(n => !resolveIcon(n));

    expect(missing).toEqual([]);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(REQUIRED.length + 40);
  });

  it('matches case-insensitively, ignores punctuation, and takes the usual aliases', () => {
    expect(resolveIcon('lock')).toBe('Lock');
    expect(resolveIcon('check-circle')).toBe('CheckCircle');
    expect(resolveIcon('CHECK_CIRCLE')).toBe('CheckCircle');
    expect(resolveIcon('paper plane')).toBe('Send');
    expect(resolveIcon('Robot')).toBe('Bot');
    expect(resolveIcon('circle-check')).toBe('CheckCircle');
    expect(resolveIcon('Unicorn')).toBeNull();
    expect(resolveIcon('')).toBeNull();
  });

  it('draws an inline SVG in currentColor, and nothing for an unknown name', () => {
    const svg = iconSvg('Lock', { size: 64 })!;

    expect(svg).toMatch(/^<svg [^>]*width="64"[^>]*stroke="currentColor"/);
    expect(svg).toContain('<rect');
    expect(iconSvg('Unicorn')).toBeNull();
  });

  it('builds the runtime table from what a deck uses, leaving unknown names out', () => {
    expect(Object.keys(iconTable(['Lock', 'paper-plane', 'Unicorn'])).sort()).toEqual(['lock', 'paperplane']);
  });
});
