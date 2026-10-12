/** Stable slug for a tag name. Swedish letters are folded so slugs stay ASCII. */
export function tagSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 80) || 'tag';
}
