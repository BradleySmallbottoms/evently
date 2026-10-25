/** Sliding window of timestamps, keyed by a normalized email. */
export function createEmailWindowLimit(options: {
  now: () => Date;
  windowSeconds: number;
  max: number;
}) {
  const hits = new Map<string, number[]>();
  return function allow(email: string): boolean {
    const at = options.now().getTime();
    const start = at - options.windowSeconds * 1000;
    const recent = (hits.get(email) ?? []).filter((t) => t >= start);
    if (recent.length >= options.max) {
      hits.set(email, recent);
      return false;
    }
    recent.push(at);
    hits.set(email, recent);
    return true;
  };
}
