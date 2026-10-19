import { RNHostView } from '@expo/ui/swift-ui';
import type { ReactElement } from 'react';

/**
 * A sheet is presented in its own window, so React Native touches never reach
 * plain views inside it. This host owns those touches. `fill` uses the sheet's
 * own height so a footer can sit at the bottom.
 */
export function SheetBody({ children, fill = false }: { children: ReactElement; fill?: boolean }) {
  return <RNHostView matchContents={!fill}>{children}</RNHostView>;
}
