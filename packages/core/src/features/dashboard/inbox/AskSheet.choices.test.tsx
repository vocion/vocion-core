import type { SheetAsk } from './AskSheet';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import { AskSheet } from './AskSheet';

/**
 * WHAT EACH ANSWER DOES (Chris, 2026-09-29, on a ruling with no options:
 * "there's nothing 'Proposed' in this Ruling. what is it going to do if I hit
 * approve? make that clear").
 *
 * An ask's named options ARE the choices, each with its consequence. With none,
 * Approve / Reject / Mark done say what the answer does, which comes from
 * what is subscribed to it and never from "go ahead as proposed".
 *
 * Fixtures are fictional: Northwind and Kestrel Capital.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/inbox/41',
}));
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  usePathname: () => '/dashboard/inbox/41',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

function ruling(more: Partial<SheetAsk> = {}): SheetAsk {
  return {
    id: 41,
    kind: 'ruling',
    title: 'Share links fail for Northwind: who owns the fix?',
    body: 'Share links started failing ten minutes ago. Someone in engineering needs to own it.',
    options: [],
    contextUrl: null,
    contextMd: null,
    agentSlug: null,
    teamSlug: null,
    risk: null,
    ...more,
  };
}

function mount(ask: SheetAsk) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AskSheet asks={[ask]} kind="ruling" />
    </NextIntlClientProvider>,
  );
}

const radios = () => page.getByRole('radio').elements().map(el => el.textContent ?? '');

describe('the ask page says what each answer does', () => {
  it('a ruling with no options never claims a proposal, and says nothing runs when nothing is subscribed', async () => {
    await mount(ruling({ listeners: { approve: [], reject: [], done: [], other: [] } }));

    await expect.element(page.getByRole('radio', { name: /Approve/ })).toBeVisible();

    const rows = radios();

    expect(rows.join(' ')).not.toMatch(/as proposed/i);
    expect(rows.find(r => r.startsWith('Approve'))).toContain('Yes. Your answer is recorded for whoever asked; nothing runs on its own.');
    expect(rows.find(r => r.startsWith('Reject'))).toContain('No. Your answer is recorded for whoever asked; nothing runs on its own.');
    // Nor does the free-text row promise a reader nobody wired up.
    expect(rows.find(r => r.startsWith('Other'))).toContain('Answer in your own words. Your answer is recorded for whoever asked; nothing runs on its own.');
  });

  it('names the asker and what an answer starts when something is subscribed to it', async () => {
    await mount(ruling({
      agentSlug: 'incident-lead',
      listeners: { approve: ['Page the on-call engineer'], reject: [], done: [], other: [] },
    }));

    await expect.element(page.getByRole('radio', { name: /Approve/ })).toBeVisible();

    const rows = radios();

    expect(rows.find(r => r.startsWith('Approve'))).toContain('Yes. Starts “Page the on-call engineer”.');
    expect(rows.find(r => r.startsWith('Reject'))).toContain('No. Your answer is recorded for incident-lead; nothing runs on its own.');
  });

  it('claims nothing it did not check when the page did not look up what an answer starts', async () => {
    await mount(ruling({ agentSlug: 'incident-lead' }));

    await expect.element(page.getByRole('radio', { name: /Approve/ })).toBeVisible();

    const approve = radios().find(r => r.startsWith('Approve'))!;

    expect(approve).toContain('Yes. Your answer is recorded for incident-lead.');
    expect(approve).not.toMatch(/nothing runs|as proposed/i);
  });

  it('an ask with named options offers exactly those, each with its consequence, and no generic Approve or Reject', async () => {
    await mount(ruling({
      title: 'Who owns the Kestrel Capital share-link fix?',
      options: [
        { id: 'platform', label: 'Platform team owns it', description: 'The platform lead is paged and the fix is theirs.', recommended: true },
        { id: 'integrations', label: 'Integrations team owns it', description: 'The integrations lead is paged instead.' },
      ],
    }));

    await expect.element(page.getByRole('radio', { name: /Platform team owns it/ })).toBeVisible();

    const rows = radios();

    // The two options plus the free-text Other, nothing else.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('The platform lead is paged and the fix is theirs.');
    expect(rows[1]).toContain('The integrations lead is paged instead.');
    expect(rows[2]).toMatch(/^Other/);
    expect(page.getByRole('radio', { name: /^Approve/ }).elements()).toHaveLength(0);
    expect(page.getByRole('radio', { name: /^Reject/ }).elements()).toHaveLength(0);
    expect(page.getByRole('radio', { name: /^Mark done/ }).elements()).toHaveLength(0);
  });
});
