import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import messages from '@/locales/en.json';
import { ReviewHeader } from './ReviewHeader';
import { UpNextMenu } from './UpNextMenu';
import '@/styles/global.css';

/**
 * The P0 from `docs/specs/discovery-ledger-v2.md`: *"The heading wraps to one
 * word per line in a ~150px container while the rest of the page has huge
 * unused space."*
 *
 * The cause was flex, not content. The title block was `flex-1`, i.e.
 * `flex-basis: 0` — a flex item with a zero basis has a hypothetical main size
 * of zero, contributes nothing to the line's overflow, and therefore never
 * triggers a wrap. Beside it the queue controls were `sm:shrink-0`. So every
 * pixel the Up-next label wanted came out of the title, down to its `min-w-0`
 * floor. Measured at 1024px with a real queue title: **163px**, one word per
 * line, on a page with 800px spare.
 *
 * This asserts the geometry rather than the class names, because the next
 * person to touch this row will change the classes and should find out here
 * whether they reintroduced the collapse.
 */

const LONG = 'Discovery call detected: Northwind Health <> Acme — technical diligence follow-up, Sep 14 2026';
const NEXT = [{ id: 11, title: LONG, typeLabel: 'Review discovery call → proposal' }];

async function renderHeader() {
  await render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="px-6 py-4">
        <ReviewHeader
          crumbs={[{ label: 'Workspace' }, { label: 'Needs you' }, { label: 'Discovery' }]}
          title={LONG}
          status="pending"
          canBack
          onBack={() => {}}
          upNext={<UpNextMenu next={NEXT} remaining={212} onSkipTo={() => {}} />}
        />
      </div>
    </NextIntlClientProvider>,
  );
  return document.querySelector('h1')!;
}

describe('ReviewHeader geometry', () => {
  it('gives the H1 the line, however wide the queue controls beside it want to be', async () => {
    await page.viewport(1024, 500);
    const h1 = await renderHeader();

    // Comfortably more than half the 1024px viewport — the controls wrap to
    // their own row rather than squeezing the heading.
    expect(h1.getBoundingClientRect().width).toBeGreaterThan(700);
  });

  it('still gives it the line on a narrow desktop', async () => {
    await page.viewport(820, 500);
    const h1 = await renderHeader();

    expect(h1.getBoundingClientRect().width).toBeGreaterThan(500);
  });
});
