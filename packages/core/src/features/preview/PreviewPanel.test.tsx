import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * The preview's contract, which is the same contract on every surface:
 * one panel at a time, Escape closes it and hands focus back to whatever
 * opened it, and the page's own shortcuts keep working underneath — a
 * reviewer must still be able to approve with `a` while reading the evidence
 * they are approving on.
 *
 * Every citation here is fixture data.
 */

const resolved = {
  ref: { type: 'document', id: 'granola:fixture-note' },
  title: 'Platform kickoff',
  sourceLabel: 'Granola',
  facts: [{ label: 'Participants', value: 'Fixture One, Fixture Two' }],
  body: 'Transcript body for the fixture meeting.',
  href: '/dashboard/search/42',
};

const unresolved = {
  ref: { type: 'document', id: 'docuseal:7c9a11' },
  title: 'Contract',
  sourceLabel: 'DocuSeal',
  unresolved: { reason: 'No synced copy of this reference was found in this workspace.', reference: 'docuseal:7c9a11' },
};

vi.mock('@/libs/Orpc', () => ({
  client: {
    preview: {
      get: vi.fn(async (input: { id: string }) => (input.id.startsWith('docuseal:') ? unresolved : resolved)),
    },
  },
}));

// next-intl's Link needs the routing provider; a plain anchor is enough here.
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { EvidenceRefs } = await import('./EvidenceRefs');

const SOURCES = ['granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', 'docuseal:7c9a11'];

/**
 * The evidence list, a decision button, and the page shortcut that must survive.
 * @param props
 * @param props.onApprove
 */
function Harness(props: { onApprove: () => void }) {
  // The page's own shortcut, bound the way the decision sheets bind theirs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'a') {
        props.onApprove();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div>
      <EvidenceRefs sources={SOURCES} />
      <button type="button" data-testid="approve">Approve</button>
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('the preview panel', () => {
  it('opens one panel from a citation and never renders a raw id as the label', async () => {
    render(<Harness onApprove={() => {}} />);
    const refs = page.getByTestId('evidence-ref');

    await expect.element(refs.nth(0)).toHaveTextContent('Granola meeting');
    await expect.element(refs.nth(0)).not.toHaveTextContent('9f1c2d3e');

    await refs.nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Platform kickoff');
    expect(page.getByTestId('preview-panel').elements()).toHaveLength(1);
  });

  it('carries the source chip and the link to the full page', async () => {
    render(<Harness onApprove={() => {}} />);
    await page.getByTestId('evidence-ref').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Granola');
    await expect.element(page.getByTestId('preview-detail-link')).toHaveAttribute('href', '/dashboard/search/42');
  });

  it('puts the open preview in the URL, so it is linkable', async () => {
    render(<Harness onApprove={() => {}} />);
    await page.getByTestId('evidence-ref').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    expect(new URLSearchParams(window.location.search).get('preview'))
      .toBe('document:granola:9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f');
  });

  it('closes on Escape and hands focus back to what opened it', async () => {
    render(<Harness onApprove={() => {}} />);
    const trigger = page.getByTestId('evidence-ref').nth(0);
    await trigger.click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByTestId('preview-panel')).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
    expect(new URLSearchParams(window.location.search).get('preview')).toBeNull();
  });

  it('does not trap focus: the page\'s decision shortcut still fires while it is open', async () => {
    const onApprove = vi.fn();
    render(<Harness onApprove={onApprove} />);
    await page.getByTestId('evidence-ref').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    await userEvent.keyboard('a');

    expect(onApprove).toHaveBeenCalled();
    await expect.element(page.getByTestId('preview-panel')).toBeVisible();
  });

  it('swaps to the other citation rather than opening a second panel', async () => {
    render(<Harness onApprove={() => {}} />);
    await page.getByTestId('evidence-ref').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Platform kickoff');

    await page.getByTestId('evidence-ref').nth(1).click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('DocuSeal');
    expect(page.getByTestId('preview-panel').elements()).toHaveLength(1);
  });

  it('says plainly what it could not resolve, and still shows the raw reference', async () => {
    render(<Harness onApprove={() => {}} />);
    await page.getByTestId('evidence-ref').nth(1).click();

    const panel = page.getByTestId('preview-panel');

    await expect.element(panel).toHaveTextContent('No synced copy of this reference was found');
    await expect.element(panel).toHaveTextContent('docuseal:7c9a11');
  });

  it('closes from the close button too', async () => {
    render(<Harness onApprove={() => {}} />);
    await page.getByTestId('evidence-ref').nth(0).click();

    await expect.element(page.getByTestId('preview-panel')).toBeVisible();

    await page.getByTestId('preview-close').click();

    await expect.element(page.getByTestId('preview-panel')).not.toBeInTheDocument();
  });
});
