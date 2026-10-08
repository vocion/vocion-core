import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { listBrands } from '@/libs/brands/catalog';
import { IntegrationLogo } from './IntegrationLogo';
import '@/styles/global.css';

describe('IntegrationLogo', () => {
  it('draws a simple-icons brand as a path in the tile', async () => {
    const { container } = await render(<IntegrationLogo brand="github" name="GitHub" />);

    expect(container.querySelector('[data-logo="path"] svg path')).not.toBeNull();
  });

  it('draws a vendored brand from its own file, with the kit\'s dark variant beside it', async () => {
    const { container } = await render(<IntegrationLogo brand="tavily" name="Tavily" />);
    const images = [...container.querySelectorAll('[data-logo="file"] img')] as HTMLImageElement[];

    expect(images.map(image => new URL(image.src).pathname)).toEqual(['/brand/integrations/tavily/tavily-mark-black.svg', '/brand/integrations/tavily/tavily-mark-offwhite.svg']);
  });

  it('serves every vendored file, so no tile shows a broken image', async () => {
    for (const brand of listBrands()) {
      if (brand.mark?.kind !== 'file') {
        continue;
      }
      const { container, unmount } = await render(<IntegrationLogo brand={brand.key} name={brand.title} />);
      for (const image of container.querySelectorAll('img')) {
        await image.decode();

        expect(image.naturalWidth, `${brand.key} ${image.src}`).toBeGreaterThan(0);
      }
      await unmount();
    }
  });

  it('falls back to the icon or monogram for a brand with no logo, and to nothing when asked', async () => {
    const tile = await render(<IntegrationLogo brand="slack" name="Slack" />);

    expect(tile.container.textContent).toBe('Sl');

    const bare = await render(<IntegrationLogo brand="slack" name="Slack" markOnly />);

    expect(bare.container.innerHTML).toBe('');
  });
});
