import { facebookReturnPath } from '@/lib/facebook-return';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  try {
    return facebookReturnPath(path, initial);
  } catch {
    return path;
  }
}
