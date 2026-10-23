'use client';

import type { PageView } from './PageContextProvider';
import { usePageView } from './useRecordContext';

/**
 * Server-component-friendly way to declare what a page shows (its name and
 * a few label/value pairs): render this once anywhere in the page tree.
 * Renders nothing.
 * @param props - The page's view.
 * @param props.title - The page's name, as its title bar reads ("Review queue").
 * @param props.state - What it shows, as label/value pairs.
 */
export function PageViewContext(props: PageView) {
  usePageView({ title: props.title, state: props.state });
  return null;
}
