const DESCRIPTION_LIMIT = 1_200;
const TIP_LIMIT = 4_000;

/**
 * Lines the scan prompt uses for the event body. A tip is sent in place of folding
 * those chat lines into the description. A written description is still included.
 */
export function scanEventLines(event: {
  description?: string | null;
  tip?: { text?: string; categoryHint?: string } | null;
}): string[] {
  const text = event.tip?.text?.trim();
  const category = event.tip?.categoryHint?.trim();
  const description = event.description?.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
  if (text || category) {
    const lines = ['Tip:'];
    if (text) lines.push(text.slice(0, TIP_LIMIT));
    if (description) lines.push(`Description: ${description}`);
    if (category) lines.push(`Category: ${category}`);
    return lines;
  }
  return description ? [`Description: ${description}`] : [];
}
