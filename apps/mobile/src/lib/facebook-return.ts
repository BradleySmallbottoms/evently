/**
 * Facebook returns to the app through `fb{app-id}://…` after a share.
 * That address is not a screen. Drop it so the open event stays put.
 * A cold start from the same address opens home.
 */
export function facebookReturnPath(path: string, initial: boolean): string | null {
  if (!/^fb\d+:/i.test(path.trim())) return path;
  return initial ? '/' : null;
}
