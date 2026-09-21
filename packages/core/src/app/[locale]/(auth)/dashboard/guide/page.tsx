import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { OperatingIntentEditor } from '@/features/dashboard/guide/OperatingIntentEditor';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { readOperatingIntent } from '@/services/workspace/OperatingIntentService';

/**
 * Guide, the fourth verb.
 *
 * See is what is true, Understand is what happened, Decide is what needs a
 * person. Guide is what a person wants NEXT: outcomes, what beats what, what
 * may not happen without asking, what may be spent, which classes of action
 * run unattended, and the product judgment no agent can derive from records.
 *
 * It renders `operating-intent.yaml` rather than a settings table, because
 * the value of a stated priority is that it is versioned and that the agents
 * read the same words a person wrote. Editing goes through the action rail,
 * so a change of direction is a decision with a reason on it.
 *
 * What this page will NOT claim: the budget is advisory. It is composed into
 * the prompts of the agents that choose work, and it does not stop a run. The
 * page says so beside the number, because a number a person believes is a cap
 * and is not one is worse than no number at all.
 * @param props - Route props.
 * @param props.params - The locale segment.
 */
export default async function GuidePage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const description = 'What you want the factory doing: outcomes, what beats what, what it may not do without asking, what it may spend, and the judgment it cannot derive from records.';

  if (!orgId) {
    return (
      <>
        <TitleBar title="Guide" description={description} />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to an organization to read its operating intent.</div>
      </>
    );
  }

  const read = await readOperatingIntent(orgId);
  const intent = read.intent;

  return (
    <>
      <TitleBar
        title="Guide"
        description={description}
        actions={<OperatingIntentEditor initialText={read.text ?? ''} blocker={read.blocker} />}
      />

      {read.error && (
        <div className="mb-6 rounded-md border border-destructive/40 p-4 text-[13px] text-destructive">
          {'operating-intent.yaml is on disk but does not load, so the agents are reading nothing: '}
          {read.error}
        </div>
      )}

      {!intent && !read.error && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">This factory has been told nothing.</p>
          <p>
            No
            {' '}
            <code>operating-intent.yaml</code>
            {' '}
            is authored, so the agents that choose work have no stated outcome, no ranking and no constraint to read. That is not the same as permission: they report the absence rather than assuming anything is allowed.
          </p>
        </div>
      )}

      {intent && (
        <div className="space-y-8">
          <Section
            title="What we are trying to achieve now"
            empty="No outcome stated. The factory is working without a destination it can name."
          >
            {intent.outcomes.map(o => (
              <li key={o.statement} className="text-sm">
                <span className="font-medium">{o.statement}</span>
                {o.by && <span className="text-muted-foreground">{` by ${o.by}`}</span>}
                {o.because && <div className="text-[13px] text-muted-foreground">{`Because ${o.because}`}</div>}
              </li>
            ))}
          </Section>

          <Section
            title="What beats what"
            note="The order is the ranking. An agent choosing between two candidates reads down this list, and names the rule that decided."
            empty="No ranking stated, so nothing here settles a tie between two pieces of work."
          >
            {intent.priorities.map((p, i) => (
              <li key={p.statement} className="text-sm">
                <span className="mr-2 text-muted-foreground">{i + 1}</span>
                <span className="font-medium">{p.statement}</span>
                {p.over && <span className="text-muted-foreground">{` over ${p.over}`}</span>}
              </li>
            ))}
          </Section>

          <Section
            title="What it may not do without asking"
            note="These are refusals, not preferences. An agent about to do one raises an ask and stops."
            empty="No constraint stated."
          >
            {intent.constraints.map(c => (
              <li key={c.statement} className="text-sm">
                <span className="font-medium">{c.statement}</span>
                {c.because && <div className="text-[13px] text-muted-foreground">{`Because ${c.because}`}</div>}
              </li>
            ))}
          </Section>

          <section>
            <h2 className="mb-1 text-sm font-semibold">Budget</h2>
            {intent.budget
              ? (
                  <div className="rounded-md border border-border p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{`$${(intent.budget.limitCents / 100).toFixed(2)} per ${intent.budget.window}`}</span>
                      <Badge variant="outline">Advises, does not enforce</Badge>
                    </div>
                    {intent.budget.note && <p className="mt-1 text-[13px] text-muted-foreground">{intent.budget.note}</p>}
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      This figure is composed into the prompts of the agents that choose work, so they plan inside it and say when a plan would exceed it. It does NOT stop a run. The run caps and the autonomy service are what actually stop spending, and a figure here that disagrees with those caps does not override them.
                    </p>
                  </div>
                )
              : <p className="text-[13px] text-muted-foreground">No budget stated. The enforced caps in Autonomy are the only limit.</p>}
          </section>

          <Section
            title="Autonomy, as stated"
            note="The stated intent. trust.yaml is what actually gates an action; where the two disagree, the ladder wins and the disagreement is worth fixing."
            empty="No autonomy policy stated, so the trust ladder stands alone."
          >
            {intent.autonomy.map(a => (
              <li key={a.actionClass} className="text-sm">
                <span className="font-medium">{a.actionClass}</span>
                <Badge className="ml-2" variant="outline">{a.policy}</Badge>
                {a.because && <div className="text-[13px] text-muted-foreground">{a.because}</div>}
              </li>
            ))}
          </Section>

          <Section
            title="Product judgment"
            note="What the agents cannot derive from records: taste, standing calls, what was tried and did not work."
            empty="No judgment notes."
          >
            {intent.productJudgment.map(note => (
              <li key={note} className="text-sm">{note}</li>
            ))}
          </Section>

          <p className="text-[13px] text-muted-foreground">
            {intent.reviewedAt ? `Last reviewed by a person on ${intent.reviewedAt}.` : 'Nobody has recorded when this was last reviewed.'}
            {read.path && ` Authored at ${read.path.split('/').slice(-2).join('/')}.`}
          </p>
        </div>
      )}
    </>
  );
}

function Section(props: { title: string; note?: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(props.children) ? props.children : [props.children];
  const hasItems = items.flat().filter(Boolean).length > 0;
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">{props.title}</h2>
      {props.note && <p className="mb-2 max-w-2xl text-[13px] text-muted-foreground">{props.note}</p>}
      {hasItems
        ? <ul className="space-y-2 rounded-md border border-border p-4">{props.children}</ul>
        : <p className="text-[13px] text-muted-foreground">{props.empty}</p>}
    </section>
  );
}
