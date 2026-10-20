import type { ReactNode } from 'react';
import { cn } from 'cn';

const widths = {
  xs: 'max-w-sm',
  sm: 'max-w-xl',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
} as const;

export function PageMain({
  children,
  maxWidth = 'md',
  className,
}: {
  children: ReactNode;
  maxWidth?: keyof typeof widths;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full flex-1 flex-col gap-6 px-5 py-10 md:py-16',
        widths[maxWidth],
        className,
      )}
    >
      {children}
    </main>
  );
}
