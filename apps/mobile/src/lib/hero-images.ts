/** Hero first, then gallery photos, with duplicate URLs removed. */
export function heroImageUrls(
  imageUrl: string | null | undefined,
  imageUrls: readonly string[] | undefined,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const url of [imageUrl, ...(imageUrls ?? [])]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}
