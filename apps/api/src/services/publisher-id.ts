/** pending_scan rows have no publisher. Routes that load a published or managed event never return one. */
export function requirePublisherId(id: string | null): string {
  if (!id) throw new Error('event has no publisher');
  return id;
}
