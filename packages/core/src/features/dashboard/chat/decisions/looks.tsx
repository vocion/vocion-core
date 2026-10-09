'use client';

import type { ReactNode } from 'react';
import type { DecisionOption } from '@/libs/decisions/decision';
import { useTheme } from 'next-themes';
import { BrandPreview } from '@/features/branding/BrandPreview';
import { draftFieldsOf, previewViewOf } from '@/libs/branding/orgBrand';

/**
 * WHAT AN OPTION'S EFFECT WILL LOOK LIKE, drawn on the Decision card before it
 * runs. An option names its renderer (`AskOption.look`, set from the card
 * kind's descriptor) and carries its action's input; this registry draws it.
 * A renderer the client does not know draws nothing — the option still says
 * what it does in words.
 */

type LookRenderer = (data: Record<string, unknown>, theme: 'light' | 'dark') => ReactNode;

const LOOKS: Record<string, LookRenderer> = {
  // "Make it yours": the app's own chrome wearing the drafted brand.
  brand: (data, theme) => <BrandPreview brand={previewViewOf(draftFieldsOf(data))} theme={theme} />,
};

/**
 * The picture of an option's effect, or nothing.
 * @param props - The look.
 * @param props.look - The option's look.
 * @param props.theme - Draw it in this theme (stories); the app's own otherwise.
 */
export function DecisionLook({ look, theme }: { look: NonNullable<DecisionOption['look']>; theme?: 'light' | 'dark' }) {
  const { resolvedTheme } = useTheme();
  const draw = LOOKS[look.renderer];
  if (!draw) {
    return null;
  }
  return <div className="mt-2.5" data-testid="decision-look" data-renderer={look.renderer}>{draw(look.data, theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light'))}</div>;
}
