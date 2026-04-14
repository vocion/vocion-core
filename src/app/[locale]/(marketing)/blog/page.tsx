import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/libs/I18nNavigation';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Blog — Compiles.ai',
  description: 'Writing from the Compiles.ai team on AI operations, context-as-code, and the delivery of agentic workflows.',
};

export default async function BlogPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Writing on AI operations, context-as-code, and shipping agentic workflows is coming soon.
          In the meantime, explore the
          {' '}
          {' '}
          <Link href="/docs" className="font-medium text-foreground underline underline-offset-4">docs</Link>
          {' '}
          or the
          {' '}
          <Link href="/solve" className="font-medium text-foreground underline underline-offset-4">product overview</Link>
          .
        </p>
      </div>
      <Footer />
    </>
  );
}
