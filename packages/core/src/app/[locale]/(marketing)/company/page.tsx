import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Footer } from '@/templates/Footer';
import { Navbar } from '@/templates/Navbar';

export const metadata: Metadata = {
  title: 'Company — Compiles.ai',
  description: 'Compiles.ai is built by MetaCTO — a product engineering studio turning AI experiments into operational systems.',
};

export default async function CompanyPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Company</h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Compiles.ai is built by
          {' '}
          <strong className="text-foreground">MetaCTO</strong>
          {' '}
          — a product engineering studio
          that turns AI experiments into operational systems. We dogfood Compiles.ai on our own sales pipeline and
          customer accounts; the platform is what we needed to exist and decided to build.
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">What we do</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We design, build, and run AI systems for mid-market companies. Engagement shapes range from a 4-week
              sprint proving a single workflow to continuous managed operations keeping 10+ workflows tuned and running.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Why this exists</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Every engagement needed the same substrate: context as code, skills as plugins, workflows with humans in
              the loop, one review queue. Compiles.ai is that substrate, open-sourced, so the work is portable and the
              ecosystem can grow beyond one studio.
            </p>
          </div>
        </div>

        <div className="mt-16 rounded-xl border border-border bg-muted/30 p-6">
          <h2 className="text-lg font-semibold">Get in touch</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <a href="mailto:hello@metacto.com" className="font-medium text-foreground underline underline-offset-4">
              hello@metacto.com
            </a>
          </p>
        </div>
      </div>
      <Footer />
    </>
  );
}
