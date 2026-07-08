import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-[4px] bg-muted', className)} {...props} />;
}

export { Skeleton };
