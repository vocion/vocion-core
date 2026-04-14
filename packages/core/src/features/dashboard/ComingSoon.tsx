import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const ComingSoon = (props: {
  title: string;
  description: string;
  features?: string[];
}) => (
  <div className="flex h-full flex-col items-center justify-center rounded-md">
    <div className="size-16 rounded-full bg-muted p-3">
      <Clock className="size-full stroke-muted-foreground stroke-2" />
    </div>

    <div className="mt-3 mb-24 text-center">
      <div className="flex items-center justify-center gap-2">
        <div className="text-xl font-semibold">{props.title}</div>
        <Badge variant="secondary">Phase 2</Badge>
      </div>
      <div className="mt-1 text-sm font-medium text-muted-foreground">
        {props.description}
      </div>

      {props.features && props.features.length > 0 && (
        <div className="mx-auto mt-6 max-w-md">
          <div className="rounded-md border border-border p-4">
            <div className="mb-3 text-sm font-semibold">What's coming</div>
            <ul className="space-y-2 text-left text-sm text-muted-foreground">
              {props.features.map(feature => (
                <li key={feature} className="flex items-center gap-2">
                  <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  </div>
);
