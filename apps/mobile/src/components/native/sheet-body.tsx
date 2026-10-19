import type { ReactElement } from 'react';

/** Passthrough on Android and web. iOS wraps sheet content so it can be tapped. */
export function SheetBody({ children }: { children: ReactElement; fill?: boolean }) {
  return children;
}
