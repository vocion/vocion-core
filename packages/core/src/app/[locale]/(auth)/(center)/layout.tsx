import { setRequestLocale } from 'next-intl/server';
import { brandViewForRequest } from '@/services/branding/OrgBrandService';

/**
 * Sign-in, invites and email-link landings, centred, over an ambient glow —
 * in the Org's accent when its brand has one, Vocion's colours otherwise.
 * @param props - The route's props.
 * @param props.children - The page.
 * @param props.params - The locale.
 */
export default async function CenteredLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const brand = await brandViewForRequest().catch(() => null);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Ambient brand glow — subtle aurora, theme-aware via opacity. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {brand?.accent
          ? (
              <>
                <div data-testid="org-accent-glow" className="absolute top-0 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-gradient-to-br from-org-accent/20 via-org-accent/5 to-transparent blur-3xl" />
                <div className="absolute right-0 bottom-0 h-[30rem] w-[30rem] translate-x-1/4 translate-y-1/4 rounded-full bg-gradient-to-tr from-org-accent/10 to-transparent blur-3xl" />
              </>
            )
          : (
              <>
                <div className="absolute top-0 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-gradient-to-br from-indigo-500/20 via-sky-500/10 to-transparent blur-3xl" />
                <div className="absolute right-0 bottom-0 h-[30rem] w-[30rem] translate-x-1/4 translate-y-1/4 rounded-full bg-gradient-to-tr from-fuchsia-500/10 to-transparent blur-3xl" />
              </>
            )}
      </div>
      {props.children}
    </div>
  );
}
