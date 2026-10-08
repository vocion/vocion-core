import { describe, expect, it } from 'vitest';
import { AGENT_ACCENT_NAMES, agentAccent } from './agentAccents';

/**
 * WCAG relative luminance of a #rrggbb colour.
 * @param hex
 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('agentAccent', () => {
  it('falls back to amber for an unknown or missing accent', () => {
    expect(agentAccent(undefined)).toEqual(agentAccent('amber'));
    expect(agentAccent('chartreuse')).toEqual(agentAccent('amber'));
  });

  it('reads the authored name case-insensitively', () => {
    expect(agentAccent('Emerald')).toEqual(agentAccent('emerald'));
  });

  it.each(AGENT_ACCENT_NAMES)('%s: a white initial on its dot clears AA', (name) => {
    expect(contrast(agentAccent(name).dot, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
