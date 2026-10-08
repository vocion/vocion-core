import { AuthBrandLogo, AuthPoweredBy } from '@/features/branding/AuthBrand';

/**
 * The card every signed-out step sits in — sign-in, the second factor,
 * forgot and reset password — so they read as one flow: the mark, a title, a
 * line under it, then the step's own form. On an Org with a brand
 * (`services/branding`) the mark is the Org's logo, with a small "Powered by
 * Vocion" under the card.
 * @param props - The card's content.
 * @param props.title - What this step is.
 * @param props.subtitle - One line on what to do here.
 * @param props.children - The step's form.
 */
export function AuthCard(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm px-4">
      <div className="rounded-2xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-black/5 backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <AuthBrandLogo />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
            {props.subtitle && <p className="text-sm text-muted-foreground">{props.subtitle}</p>}
          </div>
        </div>
        {props.children}
      </div>
      <AuthPoweredBy />
    </div>
  );
}
