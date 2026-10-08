import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListPage } from '@/components/patterns';
import { TemplatePicker } from '@/features/dashboard/apps/TemplatePicker';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { loadApp } from '@/libs/workspace/apps';
import { userSchema } from '@/models/Schema';
import { appTemplatesForProject } from '@/services/apps/AppTemplateService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * An app's start page: the templates it ships, each a function stood up in
 * one move (`templates/apps/<app>/templates/`). The Company app's entry, and
 * any app that ships templates gets the same page — core names no app here.
 * @param props - The route.
 * @param props.params - The locale and the app id.
 */
export async function generateMetadata(props: { params: Promise<{ app: string }> }): Promise<Metadata> {
  const { app } = await props.params;
  try {
    return { title: loadApp(app).name };
  } catch {
    return {};
  }
}

export default async function AppStartPage(props: { params: Promise<{ locale: string; app: string }> }) {
  const { locale, app } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId, has } = await auth();
  if (!orgId || !userId) {
    return notFound();
  }
  const [viewer] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, userId)).limit(1);
  const view = await appTemplatesForProject(orgId, app, { email: viewer?.email ?? '', name: viewer?.name ?? '' });
  if (!view || view.templates.length === 0) {
    return notFound();
  }
  return (
    <ListPage title={view.app.name} description={view.app.description}>
      <TemplatePicker appId={view.app.id} templates={view.templates} writable={view.writable} canInstall={has({ role: ORG_ROLE.ADMIN })} />
    </ListPage>
  );
}
