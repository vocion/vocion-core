/**
 * The send's body, edited as it will arrive.
 *
 * What matters here is not the toolbar. It is that the editor emits the HTML
 * HubSpot will receive, that loading a body does NOT count as editing it (an
 * emit on mount changed the hash a check is drawn from and silently took an
 * approval back), and that the schema refuses anything a send cannot carry —
 * including a paste out of a word processor, which is how most real copy
 * arrives.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { RichEmailBody } from './RichEmailBody';
import '@/styles/global.css';

/** The editable surface itself. */
const field = () => page.elementLocator(document.querySelector<HTMLElement>('[contenteditable="true"]')!);

describe('what the reviewer types is what gets sent', () => {
  it('emits the body as HTML', async () => {
    const onChange = vi.fn();
    await render(<RichEmailBody value="Rowan, saw the hires." onChange={onChange} label="Day 0 body" />);

    await field().fill('Tightened.');

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(onChange.mock.calls.at(-1)![0]).toBe('<p>Tightened.</p>');
  });

  it('opens an agent\'s prose as the paragraphs it is, not one run-on line', async () => {
    await render(<RichEmailBody value={'One.\n\nTwo.'} onChange={() => {}} label="Day 0 body" />);

    expect(document.querySelectorAll('[contenteditable="true"] p')).toHaveLength(2);
  });

  it('loads a body without reporting it as an edit', async () => {
    // The defect this exists for: ProseMirror normalises on load, and
    // propagating that as a change wrote an edit nobody made — which cleared
    // every check the moment a pane mounted.
    const onChange = vi.fn();
    await render(<RichEmailBody value={'One.\n\nTwo.'} onChange={onChange} label="Day 0 body" />);

    await new Promise(r => setTimeout(r, 100));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the formatting a reviewer applies', async () => {
    const onChange = vi.fn();
    await render(<RichEmailBody value="Saw the hires." onChange={onChange} label="Day 0 body" />);

    await field().fill('Saw the hires.');
    await page.getByRole('button', { name: 'Bulleted list' }).click();

    await vi.waitFor(() => expect(onChange.mock.calls.at(-1)![0]).toContain('<ul>'));
  });
});

describe('the schema is what makes it safe', () => {
  it('refuses a heading a send cannot carry, keeping the words', async () => {
    const onChange = vi.fn();
    await render(<RichEmailBody value="<h1>Shouting</h1><p>Body.</p>" onChange={onChange} label="Day 0 body" />);

    const html = document.querySelector('[contenteditable="true"]')!.innerHTML;

    expect(html).not.toContain('<h1');
    expect(document.querySelector('[contenteditable="true"]')!.textContent).toContain('Shouting');
  });

  it('drops a script rather than loading it', async () => {
    await render(<RichEmailBody value="<p>Hi</p><script>alert(1)</script>" onChange={() => {}} label="Day 0 body" />);

    expect(document.querySelector('[contenteditable="true"] script')).toBeNull();
  });

  it('keeps a link and its href', async () => {
    await render(<RichEmailBody value='<p>The <a href="https://example.test/guide">guide</a>.</p>' onChange={() => {}} label="Day 0 body" />);

    expect(document.querySelector<HTMLAnchorElement>('[contenteditable="true"] a')?.getAttribute('href')).toBe('https://example.test/guide');
  });
});

describe('read-only', () => {
  it('renders the copy with no toolbar and no editing', async () => {
    await render(<RichEmailBody value="<p>Already decided.</p>" label="Day 0 body" />);

    expect(page.getByTestId('rich-toolbar').elements()).toHaveLength(0);
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
    await expect.element(page.getByText('Already decided.')).toBeVisible();
  });

  it('names the field for a screen reader, since there is no visible label', async () => {
    await render(<RichEmailBody value="Body." onChange={() => {}} label="Day 3 body" />);

    await expect.element(page.getByRole('textbox', { name: 'Day 3 body' })).toBeVisible();
  });
});
