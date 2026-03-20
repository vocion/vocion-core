import { StickyBanner } from '@/features/landing/StickyBanner';
import { Link } from '@/libs/I18nNavigation';

export const DemoBanner = () => (
  <StickyBanner>
    CoreContext is in private beta.
    {' '}
    <Link href="/sign-up">Request early access</Link>
  </StickyBanner>
);
