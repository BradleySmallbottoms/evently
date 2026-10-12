import { RNHostView } from '@expo/ui/swift-ui';
import type { ReactElement } from 'react';

/**
 * A sheet is presented in its own window, so React Native touches never reach
 * plain views inside it. This host owns those touches and sizes to its content.
 */
export function SheetBody({ children }: { children: ReactElement }) {
  return <RNHostView matchContents>{children}</RNHostView>;
}
