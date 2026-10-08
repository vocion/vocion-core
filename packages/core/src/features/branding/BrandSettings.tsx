'use client';

import type { PreviewTheme } from './BrandPreview';
import type { OrgBrandFields } from '@/libs/branding/orgBrand';
import type { BrandManifest } from '@/libs/workspace/brandSchema';
import { ImageUp, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { accentTokens, normalizeHex } from '@/libs/branding/contrast';
import { HEADING_FONTS } from '@/libs/branding/fonts';
import { previewViewOf } from '@/libs/branding/orgBrand';
import { useRouter } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { BrandPreview } from './BrandPreview';

/**
 * BRAND SETTINGS — an Org admin edits the Org's brand, and sees it as they go.
 *
 * Name, logo and mark (each with a version for dark pages), accent colour,
 * heading font and the name mail goes under; a live preview of the sidebar
 * and the sign-in page beside the form, in either theme. The accent is
 * checked as it is typed (`accentTokens`): a colour that has to be adjusted to
 * read on light or dark pages says what it will be; one that cannot be worn
 * says why, and Save is held until it changes.
 *
 * Saving goes through `branding.save` (the same check, on the server) and
 * offers Undo; "Reset to default" puts Vocion's own look back, with Undo too.
 * A draft from the brand card in chat arrives as `draft` and is shown,
 * unsaved, until the person saves it.
 */

export type BrandApi = {
  save: (fields: OrgBrandFields) => Promise<{ before: BrandManifest | null; fields: OrgBrandFields; notes: string[] }>;
  restore: (brand: BrandManifest | null) => Promise<{ before: BrandManifest | null; fields: OrgBrandFields | null }>;
  uploadLogo: (input: { kind: LogoKey; contentType: string; dataBase64: string }) => Promise<{ url: string }>;
};

type LogoKey = keyof OrgBrandFields['logos'];

const EMPTY: OrgBrandFields = { name: '', accent: null, headingFont: null, senderName: null, logos: {}, website: null };

const LOGO_SLOTS: ReadonlyArray<{ key: LogoKey; dark: boolean }> = [
  { key: 'wordmark', dark: false },
  { key: 'wordmarkOnDark', dark: true },
  { key: 'mark', dark: false },
  { key: 'markOnDark', dark: true },
];

export type BrandSettingsProps = {
  /** The Org's brand as saved; null when it has none. */
  initial: OrgBrandFields | null;
  /** A drafted brand to start from (the chat card's "Adjust"), unsaved. */
  draft?: Partial<OrgBrandFields> | null;
  /** The Org's own name, the starting point of a first brand. */
  orgName: string;
  /** Whether the "Powered by Vocion" mark shows (false only when white-labelled). */
  poweredBy?: boolean;
  /** The server calls; injected so a story can run without one. */
  api: BrandApi;
};

/**
 * A file as base64, without the data-URI prefix.
 * @param file - The file.
 */
async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * The page's form and preview.
 * @param props - See {@link BrandSettingsProps}.
 * @param props.initial
 * @param props.draft
 * @param props.orgName
 * @param props.poweredBy
 * @param props.api
 */
export function BrandSettings({ initial, draft, orgName, poweredBy = true, api }: BrandSettingsProps) {
  const t = useTranslations('Brand');
  const router = useRouter();
  const start = useMemo<OrgBrandFields>(() => ({
    ...EMPTY,
    ...(initial ?? { name: orgName }),
    ...(draft ? Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== undefined)) : {}),
    logos: { ...(initial?.logos ?? {}), ...(draft?.logos ?? {}) },
  }), [initial, draft, orgName]);
  const [fields, setFieldsRaw] = useState<OrgBrandFields>(start);
  // Unsaved edits: a draft from chat starts unsaved.
  const [dirty, setDirty] = useState(Boolean(draft));
  const setFields: typeof setFieldsRaw = (next) => {
    setDirty(true);
    setFieldsRaw(next);
  };
  const [saved, setSaved] = useState<OrgBrandFields | null>(initial);
  const [accentText, setAccentText] = useState(start.accent ?? '');
  const [theme, setTheme] = useState<PreviewTheme>('light');
  const [busy, setBusy] = useState<'save' | 'reset' | 'undo' | LogoKey | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string; undo?: BrandManifest | null } | null>(null);
  const inputs = useRef<Partial<Record<LogoKey, HTMLInputElement | null>>>({});

  const set = <K extends keyof OrgBrandFields>(key: K, value: OrgBrandFields[K]) => setFields(f => ({ ...f, [key]: value }));
  const accentCheck = fields.accent ? accentTokens(fields.accent) : null;
  const accentTyped = accentText.trim() !== '' && !normalizeHex(accentText);
  const view = useMemo(() => previewViewOf(fields, { poweredBy }), [fields, poweredBy]);
  const canSave = fields.name.trim() !== '' && !(accentCheck && !accentCheck.ok) && !accentTyped && busy === null;

  const onAccentText = (value: string) => {
    setAccentText(value);
    const hex = normalizeHex(value.startsWith('#') ? value : `#${value}`);
    if (hex) {
      set('accent', hex);
    } else if (value.trim() === '') {
      set('accent', null);
    }
  };

  const upload = async (key: LogoKey, file: File) => {
    setBusy(key);
    setStatus(null);
    try {
      const { url } = await api.uploadLogo({ kind: key, contentType: file.type || 'application/octet-stream', dataBase64: await fileBase64(file) });
      setFields(f => ({ ...f, logos: { ...f.logos, [key]: url } }));
    } catch (err) {
      setStatus({ ok: false, message: (err as Error)?.message || t('upload_failed') });
    }
    setBusy(null);
  };

  const save = async () => {
    setBusy('save');
    setStatus(null);
    try {
      const res = await api.save(fields);
      setFieldsRaw(res.fields);
      setDirty(false);
      setSaved(res.fields);
      setAccentText(res.fields.accent ?? '');
      setStatus({ ok: true, message: [t('saved'), ...res.notes].join(' '), undo: res.before });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, message: (err as Error)?.message || t('save_failed') });
    }
    setBusy(null);
  };

  const reset = async () => {
    // eslint-disable-next-line no-alert -- one irreversible-looking step; Undo follows it anyway
    if (!window.confirm(t('reset_confirm'))) {
      return;
    }
    setBusy('reset');
    setStatus(null);
    try {
      const res = await api.restore(null);
      setFieldsRaw({ ...EMPTY, name: orgName });
      setDirty(false);
      setSaved(null);
      setAccentText('');
      setStatus({ ok: true, message: t('reset_done'), undo: res.before });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, message: (err as Error)?.message || t('save_failed') });
    }
    setBusy(null);
  };

  const undo = async () => {
    if (status?.undo === undefined) {
      return;
    }
    setBusy('undo');
    try {
      const res = await api.restore(status.undo);
      const back = res.fields ?? { ...EMPTY, name: orgName };
      setFieldsRaw(back);
      setDirty(false);
      setSaved(res.fields);
      setAccentText(back.accent ?? '');
      setStatus({ ok: true, message: t('undone') });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, message: (err as Error)?.message || t('save_failed') });
    }
    setBusy(null);
  };

  return (
    <div data-testid="brand-settings" className="@container grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0 space-y-8">
        {draft && (
          <p data-testid="brand-draft-banner" className="rounded-lg border border-border bg-surface-soft px-3 py-2 text-[13px] text-muted-foreground">
            {fields.website ? t('draft_from', { site: fields.website.replace(/^https?:\/\//, '') }) : t('draft_unsaved')}
          </p>
        )}

        <DashboardSection title={t('section_name')} description={t('section_name_help')}>
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="brand-name">{t('field_name')}</Label>
            <Input id="brand-name" value={fields.name} onChange={e => set('name', e.target.value)} maxLength={80} required />
          </div>
        </DashboardSection>

        <DashboardSection title={t('section_logo')} description={t('section_logo_help')}>
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            {LOGO_SLOTS.map(slot => (
              <div key={slot.key} className="min-w-0" data-testid={`brand-logo-${slot.key}`}>
                <div className="mb-1.5 text-[13px] font-medium">{t(`logo_${slot.key}`)}</div>
                <div className={cn('flex h-20 items-center justify-center rounded-lg border border-border px-3', slot.dark ? 'bg-[#141217]' : 'bg-[#fcfaf6]')}>
                  {fields.logos[slot.key]
                    // eslint-disable-next-line next/no-img-element
                    ? <img src={fields.logos[slot.key]} alt={t(`logo_${slot.key}`)} className="max-h-12 max-w-full object-contain" />
                    : <span className={cn('text-[11px]', slot.dark ? 'text-[#a8a2ab]' : 'text-[#625d66]')}>{t(slot.key.startsWith('mark') ? 'logo_none_mark' : 'logo_none')}</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <input
                    ref={(el) => {
                      inputs.current[slot.key] = el;
                    }}
                    type="file"
                    accept="image/svg+xml,image/png"
                    className="sr-only"
                    aria-label={t('upload_label', { slot: t(`logo_${slot.key}`) })}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) {
                        void upload(slot.key, file);
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => inputs.current[slot.key]?.click()}>
                    {busy === slot.key ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
                    {t('upload')}
                  </Button>
                  {fields.logos[slot.key] && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => setFields((f) => {
                        const { [slot.key]: _gone, ...rest } = f.logos;
                        return { ...f, logos: rest };
                      })}
                    >
                      <X aria-hidden />
                      {t('remove')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">{t('logo_rules')}</p>
        </DashboardSection>

        <DashboardSection title={t('section_accent')} description={t('section_accent_help')}>
          <div className="flex max-w-md items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="brand-accent-picker" className="sr-only">{t('accent_picker')}</Label>
              <input
                id="brand-accent-picker"
                type="color"
                value={fields.accent ?? '#f18700'}
                onChange={e => onAccentText(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-background p-1"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="brand-accent">{t('field_accent')}</Label>
              <Input id="brand-accent" value={accentText} placeholder={t('accent_placeholder')} onChange={e => onAccentText(e.target.value)} aria-invalid={accentTyped || (accentCheck ? !accentCheck.ok : false)} />
            </div>
            {fields.accent && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onAccentText('')}>{t('accent_clear')}</Button>
            )}
          </div>
          <div className="mt-2 max-w-md text-[12px]" data-testid="brand-accent-check" aria-live="polite">
            {accentTyped
              ? <p className="text-destructive">{t('accent_not_hex')}</p>
              : accentCheck && !accentCheck.ok
                ? <p className="text-destructive" role="alert">{accentCheck.reason}</p>
                : accentCheck?.ok && accentCheck.notes.length > 0
                  ? accentCheck.notes.map(n => <p key={n} className="text-muted-foreground">{n}</p>)
                  : <p className="text-muted-foreground">{fields.accent ? t('accent_ok') : t('accent_default')}</p>}
          </div>
        </DashboardSection>

        <DashboardSection title={t('section_font')} description={t('section_font_help')}>
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="brand-font">{t('field_font')}</Label>
            <select
              id="brand-font"
              value={fields.headingFont ?? ''}
              onChange={e => set('headingFont', e.target.value || null)}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px]"
            >
              <option value="">{t('font_default')}</option>
              {HEADING_FONTS.filter(f => f.id !== 'inter').map(f => <option key={f.id} value={f.family}>{f.family}</option>)}
            </select>
          </div>
        </DashboardSection>

        <DashboardSection title={t('section_mail')} description={t('section_mail_help')}>
          <div className="max-w-md space-y-1.5">
            <Label htmlFor="brand-sender">{t('field_sender')}</Label>
            <Input id="brand-sender" value={fields.senderName ?? ''} placeholder={fields.name || orgName} maxLength={80} onChange={e => set('senderName', e.target.value || null)} />
          </div>
        </DashboardSection>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-6">
          <Button type="button" onClick={() => void save()} disabled={!canSave || !dirty} data-testid="brand-save">
            {busy === 'save' && <Loader2 className="animate-spin" aria-hidden />}
            {t('save')}
          </Button>
          {saved && (
            <Button type="button" variant="outline" onClick={() => void reset()} disabled={busy !== null} data-testid="brand-reset">
              {t('reset')}
            </Button>
          )}
          {status && (
            <p className={cn('text-[13px]', status.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')} role={status.ok ? 'status' : 'alert'} data-testid="brand-status">
              {status.message}
              {status.ok && status.undo !== undefined && (
                <>
                  {' '}
                  <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => void undo()} disabled={busy !== null} data-testid="brand-undo">{t('undo')}</button>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start" aria-label={t('preview')}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{t('preview')}</h2>
          <div role="radiogroup" aria-label={t('preview_theme')} className="inline-flex rounded-lg border border-border p-0.5 text-[12px]">
            {(['light', 'dark'] as const).map(th => (
              <button
                key={th}
                type="button"
                role="radio"
                aria-checked={theme === th}
                onClick={() => setTheme(th)}
                className={cn('rounded-md px-2 py-0.5', theme === th ? 'bg-surface-soft font-medium text-foreground' : 'text-muted-foreground')}
              >
                {t(`theme_${th}`)}
              </button>
            ))}
          </div>
        </div>
        <BrandPreview brand={view} theme={theme} />
        <p className="mt-2 text-[12px] text-muted-foreground">{t('preview_help')}</p>
      </aside>
    </div>
  );
}
