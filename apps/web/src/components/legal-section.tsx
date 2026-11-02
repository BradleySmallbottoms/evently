import type { ReactNode } from 'react';

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="text-base leading-7 text-foreground">{children}</div>
    </section>
  );
}
