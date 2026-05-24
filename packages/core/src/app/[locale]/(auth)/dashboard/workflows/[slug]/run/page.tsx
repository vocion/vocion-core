import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { getWorkflow } from '@/services/WorkflowService';
import { RunForm } from './RunForm';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export default async function WorkflowRunFormPage(props: Props) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const workflow = await getWorkflow(orgId, slug);
  if (!workflow) {
    notFound();
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/dashboard/workflows/${slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to
          {' '}
          {workflow.name}
        </Link>
      </div>

      <TitleBar
        title={`Run ${workflow.name}`}
        description={workflow.description}
      />

      <RunForm slug={slug} inputSchema={workflow.inputSchema as InputSchemaShape} />
    </>
  );
}

// Re-exported here so the client component can keep its own minimal type
// import surface without pulling the full Zod-generated workflow shape.
type InputSchemaShape = {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string; description?: string; default?: unknown }>;
} | null | undefined;
