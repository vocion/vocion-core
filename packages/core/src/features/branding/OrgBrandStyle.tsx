import type { OrgBrandView } from '@/libs/branding/orgBrand';
import { brandCss } from '@/libs/branding/orgBrand';

/**
 * The Org's brand as CSS, layered over the app's tokens: `--org-accent` and
 * its text, the accent's ink per theme, and the heading face
 * (`styles/global.css` § Org brand reads them). Rendered after the app's
 * stylesheet, so it wins; the app tints are not touched. Every value is a
 * normalised hex or an allowlisted font stack (`brandCss`), never text a
 * person typed, so it is safe to inline.
 * @param props - The brand.
 * @param props.brand - The Org's brand view, or null for nothing.
 */
export function OrgBrandStyle({ brand }: { brand: OrgBrandView | null }) {
  const css = brand ? brandCss(brand) : '';
  if (!css) {
    return null;
  }
  // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml -- generated from normalised hex values and an allowlist only
  return <style data-org-brand dangerouslySetInnerHTML={{ __html: css }} />;
}
