import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * A record's working surface: its deliverable first, supporting context one tab away.
 * @param root0
 * @param root0.label
 * @param root0.sections
 * @param root0.aside
 */
export function ObjectWorkspace({ label, sections, aside }: {
  label: string;
  sections: { id: string; label: string; content: ReactNode }[];
  aside?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]" data-object-workspace>
      <Tabs defaultValue={sections[0]?.id} className="min-w-0">
        <div className="overflow-x-auto border-b border-border pb-2">
          <TabsList aria-label={label} variant="line">
            {sections.map(section => <TabsTrigger key={section.id} value={section.id}>{section.label}</TabsTrigger>)}
          </TabsList>
        </div>
        {sections.map(section => <TabsContent key={section.id} value={section.id} className="min-w-0 pt-3">{section.content}</TabsContent>)}
      </Tabs>
      {aside && <aside className="min-w-0 space-y-5">{aside}</aside>}
    </div>
  );
}
