import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { Stat, StatRow } from './StatRow';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

describe('StatRow (design patterns, 2026-10-23)', () => {
  it('reads as label, number and a trend whose colour is the move\'s meaning', async () => {
    const { container } = await render(
      <StatRow>
        <Stat label="Spend this week" value="$412" delta={{ value: '18%', direction: 'down', tone: 'pass', against: 'vs last week' }} />
        <Stat label="RFIs issued" value="14" href="/dashboard/objects?type=rfi" />
      </StatRow>,
    );

    expect(container.querySelectorAll('[data-pattern="stat"]')).toHaveLength(2);
    expect(container.textContent).toContain('18% vs last week');
    expect(container.querySelector('.text-pass')).not.toBeNull();
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/objects?type=rfi');
  });
});
