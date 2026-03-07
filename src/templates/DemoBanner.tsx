import { StickyBanner } from '@/features/landing/StickyBanner';
import { Link } from '@/libs/I18nNavigation';

export const DemoBanner = () => (
  <StickyBanner>
    Live Demo of Vocion SaaS -
    {' '}
    <Link href="/sign-up">Explore the User Dashboard</Link>
  </StickyBanner>
);
