import { frame, tint } from '@expo/ui/swift-ui/modifiers';

import { colors } from '@/theme/colors';

/** Stretch the sheet to the screen. The sheet's own layout width is the window, not the screen. */
export function locationSheetFrame(screenWidth: number) {
  return [frame({ minWidth: screenWidth, maxWidth: Infinity, alignment: 'top' })];
}

export function accentSliderTint() {
  return [tint(colors.accent)];
}
