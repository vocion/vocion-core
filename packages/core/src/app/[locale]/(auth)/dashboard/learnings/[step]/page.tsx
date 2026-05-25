import { ArrowLeft, Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getLearnings } from '@/services/LearningsService';
import { RulesEditor } from './RulesEditor';

type Props = {
  params: Promise<{ locale: string; step: string }>;
};

export default async function LearningStepDetailPage(props: Props) {
  const { locale, step } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }

  let data;
  try {
    data = await getLearnings(orgId, step);
  } catch {
    notFound();
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/learnings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Learnings
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div>
              <div>{data.title}</div>
              <code className="font-mono text-xs font-normal text-muted-foreground">{data.step}</code>
            </div>
          </div>
        )}
        description={data.preamble ?? `Bucket of approved rules. The agent reads these as /learnings/${data.step}.md at runtime.`}
      />

      <RulesEditor
        step={data.step}
        initialRules={data.rules.map(r => ({
          id: r.id,
          ruleText: r.ruleText,
          source: r.source,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
