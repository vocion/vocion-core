import type { OrgBrandView } from '@/libs/branding/orgBrand';
import { MessageSquare, Newspaper, Search, Users } from 'lucide-react';
import { VOCION_PRIMARY_MARK } from '@/templates/VocionLogo';
import { cn } from '@/utils/Helpers';

/**
 * THE APP WEARING A BRAND, IN MINIATURE — a sidebar and a sign-in page.
 *
 * Shown where a brand is decided: the brand preview card in chat (a draft
 * read off the company's site) and the Brand settings page (a draft being
 * edited). It is drawn from the view alone, in the theme asked for, with the
 * theme's own surface colours inline — so a dark preview reads true inside a
 * light page, and a draft never leaks into the real app's tokens before it is
 * applied.
 */

export type PreviewTheme = 'light' | 'dark';

/** The app's surfaces per theme (`styles/global.css`), for a preview drawn outside the theme. */
const SURFACE: Record<PreviewTheme, { page: string; card: string; sidebar: string; ink: string; muted: string; rule: string; soft: string; active: string; actionInk: string; actionText: string; defaultAccent: string }> = {
  light: { page: '#fcfaf6', card: '#ffffff', sidebar: '#f9f7f3', ink: '#15131a', muted: '#625d66', rule: 'rgba(60,45,30,0.12)', soft: '#f4f1ec', active: 'rgba(0,0,0,0.07)', actionInk: '#15131a', actionText: '#ffffff', defaultAccent: '#c26b00' },
  dark: { page: '#141217', card: '#1c1a20', sidebar: '#1a181e', ink: '#f4f1ec', muted: '#a8a2ab', rule: 'rgba(255,255,255,0.1)', soft: '#26232b', active: 'rgba(255,255,255,0.09)', actionInk: '#f4f1ec', actionText: '#141217', defaultAccent: '#f18700' },
};

export type BrandPreviewProps = {
  brand: Pick<OrgBrandView, 'name' | 'logo' | 'mark' | 'accent' | 'headingFont' | 'poweredBy'>;
  theme?: PreviewTheme;
  /** Draw only one of the two panes (a narrow column). */
  only?: 'sidebar' | 'sign-in';
  className?: string;
};

function PreviewLogo({ brand, theme, size }: { brand: BrandPreviewProps['brand']; theme: PreviewTheme; size: 'sm' | 'lg' }) {
  const s = SURFACE[theme];
  const logo = theme === 'dark' ? (brand.logo.dark ?? brand.logo.light) : brand.logo.light;
  const mark = theme === 'dark' ? (brand.mark.dark ?? brand.mark.light) : brand.mark.light;
  const h = size === 'lg' ? 26 : 18;
  if (logo) {
    // eslint-disable-next-line next/no-img-element
    return <img src={logo} alt={brand.name} style={{ height: h, maxWidth: size === 'lg' ? 170 : 120 }} className="w-auto object-contain" />;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {mark && (
        // eslint-disable-next-line next/no-img-element
        <img src={mark} alt="" aria-hidden style={{ height: h }} className="w-auto object-contain" />
      )}
      <span className="truncate font-semibold" style={{ color: s.ink, fontSize: size === 'lg' ? 18 : 13, fontFamily: brand.headingFont?.stack }}>{brand.name}</span>
    </span>
  );
}

function Powered({ theme }: { theme: PreviewTheme }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-medium" style={{ color: SURFACE[theme].muted }}>
      Powered by
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={VOCION_PRIMARY_MARK} alt="" aria-hidden className="h-2 w-auto" />
      Vocion
    </span>
  );
}

/**
 * The preview: a sidebar beside a sign-in page, in one theme.
 * @param props - See {@link BrandPreviewProps}.
 * @param props.brand
 * @param props.theme
 * @param props.only
 * @param props.className
 */
export function BrandPreview({ brand, theme = 'light', only, className }: BrandPreviewProps) {
  const s = SURFACE[theme];
  const ink = brand.accent ? brand.accent[theme].ink : s.defaultAccent;
  const fill = brand.accent?.fill ?? s.actionInk;
  const onFill = brand.accent?.foreground ?? s.actionText;
  const railMark = (theme === 'dark' ? (brand.mark.dark ?? brand.mark.light) : brand.mark.light) ?? VOCION_PRIMARY_MARK;
  const rows = [
    { icon: MessageSquare, label: 'Chat', active: true },
    { icon: Newspaper, label: 'Briefings' },
    { icon: Search, label: 'Search' },
    { icon: Users, label: 'Teams & agents' },
  ];

  return (
    <div
      data-testid="brand-preview"
      data-theme={theme}
      className={cn('flex min-w-0 overflow-hidden rounded-xl border text-left', className)}
      style={{ background: s.page, borderColor: s.rule }}
    >
      {only !== 'sign-in' && (
        <div data-testid="brand-preview-sidebar" className="flex w-[168px] shrink-0 border-r" style={{ background: s.sidebar, borderColor: s.rule }}>
          <div className="flex w-8 shrink-0 flex-col items-center gap-2 border-r py-3" style={{ borderColor: s.rule }}>
            {/* eslint-disable-next-line next/no-img-element */}
            <img src={railMark} alt="" aria-hidden className="h-3.5 w-auto max-w-6 object-contain" />
            <span className="size-5 rounded-md" style={{ background: s.active }} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 py-3">
            <div className="mb-1 min-w-0 px-1"><PreviewLogo brand={brand} theme={theme} size="sm" /></div>
            {rows.map(r => (
              <div key={r.label} className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[10px]" style={{ background: r.active ? s.active : undefined, color: r.active ? s.ink : s.muted }}>
                <r.icon className="size-3 shrink-0" aria-hidden style={r.active ? { color: ink } : undefined} />
                <span className="truncate">{r.label}</span>
              </div>
            ))}
            <span className="mt-1 px-1.5 text-[10px] underline underline-offset-2" style={{ color: ink }}>Open the brief</span>
            {brand.poweredBy && <div className="mt-auto px-1.5 pt-3"><Powered theme={theme} /></div>}
          </div>
        </div>
      )}
      {only !== 'sidebar' && (
        <div data-testid="brand-preview-sign-in" className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-5">
          {brand.accent && <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 size-40 -translate-x-1/2 rounded-full opacity-25 blur-2xl" style={{ background: brand.accent.fill }} />}
          <div className="relative w-full max-w-[200px] rounded-lg border p-3 shadow-sm" style={{ background: s.card, borderColor: s.rule }}>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <PreviewLogo brand={brand} theme={theme} size="lg" />
              <div className="text-[12px] font-semibold" style={{ color: s.ink, fontFamily: brand.headingFont?.stack }}>Welcome back</div>
              <div className="text-[9px]" style={{ color: s.muted }}>{`Sign in to ${brand.name}`}</div>
            </div>
            <div className="mt-2.5 space-y-1.5">
              <div className="h-4 rounded" style={{ background: s.soft }} />
              <div className="h-4 rounded" style={{ background: s.soft }} />
              <div data-testid="brand-preview-button" className="flex h-5 items-center justify-center rounded text-[9px] font-medium" style={{ background: fill, color: onFill }}>Sign in</div>
            </div>
          </div>
          {brand.poweredBy && <div className="relative mt-2"><Powered theme={theme} /></div>}
        </div>
      )}
    </div>
  );
}
