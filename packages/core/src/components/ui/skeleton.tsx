import { cn } from '@/utils/Helpers';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-surface-soft animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
