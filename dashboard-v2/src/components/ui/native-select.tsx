import * as React from 'react';

import { cn } from '@/lib/cn';

export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** A plain `<select>` in the Input's clothes — for the few places (loop-in "Add…", the
 * dispatch dialog's courier) where a native control is the right tool: it works with the
 * keyboard and screen readers out of the box and needs no portal inside a nested dialog. */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-8 rounded-[4px] border border-input bg-background px-2 text-sm text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
