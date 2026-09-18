'use client';

import type { ReviewContextModel, Section } from '@/services/inbox/reviewContextModel';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, MessageSquareText, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { agoLabel } from '@/features/dashboard/inbox/inboxMeta';

/**
 * What a reviewer glances at before approving an email: who the contact is
 * and where they came from, what has already gone back and forth, whether
 * they are in a sequence — and, first, anything that would make this send a
 * double. Each section says when a system is not connected or could not be
 * read (principle 10); nothing is hidden to look tidy.
 *
 * "Ask about this contact" hands the question to the page's own agent
 * surface (the rail) through the one entry function, prefilled, so the
 * answer arrives beside the decision rather than on another page.
 * @param props
 * @param props.context - The assembled model.
 */
export function ReviewContextRail({ context }: { context: ReviewContextModel }) {
  const t = useTranslations('Review');
  const router = useRouter();
  const ask = () => {
    const who = context.contact.status === 'ok' ? (context.contact.data.name ?? context.email) : context.email;
    openAgentSurface(
      {
        prompt: `What do we know about ${who ?? 'this contact'}${context.email ? ` (${context.email})` : ''}? Recent emails both ways, the HubSpot record and how they came in, and any sequence they are in.`,
        context: { path: window.location.pathname, title: document.title, openedFrom: true },
        fallbackContext: context.email ?? '',
      },
      href => router.push(href),
    );
  };

  return (
    <aside data-testid="review-context" aria-label={t('context_label')} className="text-sm lg:sticky lg:top-4">
      {context.warnings.length > 0 && (
        <ul data-testid="review-context-warnings" className="mb-4 space-y-2">
          {context.warnings.map(w => (
            <li key={w} className="flex gap-2 rounded-md border border-brand-amber/40 bg-brand-amber-tint px-3 py-2 text-[13px] text-brand-amber-deep">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <Block title={t('context_contact')} section={context.contact}>
        {c => (
          <dl className="space-y-1 text-[13px]">
            <Row k={t('context_name')} v={c.name ?? '—'} />
            {c.jobTitle && <Row k={t('context_title')} v={c.jobTitle} />}
            {c.company && <Row k={t('context_company')} v={c.company} />}
            <Row k={t('context_stage')} v={c.lifecycleStage ?? '—'} />
            <Row k={t('context_source')} v={[c.source, c.sourceDetail].filter(Boolean).join(' · ') || '—'} />
            {c.createdAt && <Row k={t('context_since')} v={agoLabel(new Date(c.createdAt))} />}
            {c.href && (
              <dd className="pt-1">
                <a href={c.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                  {t('context_open_hubspot')}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </dd>
            )}
          </dl>
        )}
      </Block>

      <Block title={t('context_touches')} section={context.touches}>
        {touches => (
          <ul className="divide-y divide-rule">
            {touches.map(tch => (
              <li key={`${tch.source}:${tch.at}:${tch.subject}`} className="flex gap-2 py-1.5 text-[13px]">
                {tch.direction === 'in'
                  ? <ArrowDownLeft className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-label={t('context_in')} />
                  : <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-sky-600" aria-label={t('context_out')} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{tch.subject || '(no subject)'}</span>
                  {tch.snippet && <span className="block truncate text-muted-foreground">{tch.snippet}</span>}
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    {tch.at ? agoLabel(new Date(tch.at)) : ''}
                    {' · '}
                    {tch.source === 'hubspot' ? 'HubSpot' : 'Gmail'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t('context_sequence')} section={context.enrollment}>
        {e => (
          <p className="text-[13px]">
            {e.enrolled
              ? `${t('context_enrolled')}${e.sequenceName ? ` — ${e.sequenceName}` : ''}${e.enrolledBy ? ` (${e.enrolledBy})` : ''}`
              : t('context_not_enrolled')}
          </p>
        )}
      </Block>

      <button
        type="button"
        onClick={ask}
        data-testid="review-context-ask"
        className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[13px] text-primary transition hover:bg-[var(--surface-hover,var(--muted))]"
      >
        <MessageSquareText className="size-4" aria-hidden />
        {t('context_ask')}
      </button>
    </aside>
  );
}

function Block<T>({ title, section, children }: { title: string; section: Section<T>; children: (data: T) => React.ReactNode }) {
  const t = useTranslations('Review');
  return (
    <section className="border-t border-rule py-3 first:border-t-0">
      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {section.status === 'ok' && children(section.data)}
      {section.status === 'none' && <p className="text-[13px] text-muted-foreground">{t('context_none')}</p>}
      {section.status === 'not-connected' && <p className="text-[13px] text-muted-foreground">{t('context_not_connected')}</p>}
      {section.status === 'error' && <p className="text-[13px] text-muted-foreground" title={section.message}>{`${t('context_error')} ${section.message}`}</p>}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{v}</dd>
    </div>
  );
}
