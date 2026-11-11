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
    const lines = ['Tip chat (facts from the submitter, not visitor steps):'];
    if (text) lines.push(text.slice(0, TIP_LIMIT));
    if (description) lines.push(`Description: ${description}`);
    if (category) lines.push(`Category: ${category}`);
    return lines;
  }
  return description ? [`Description: ${description}`] : [];
}

/**
 * The place text the importer stored. The scan asks the model to split a venue,
 * a street and house number, and a town out of a line that mixes them.
 */
export function scanPlaceLines(event: {
  placeLine?: string | null;
  placeCity?: string | null;
}): string[] {
  const line = event.placeLine?.replace(/\s+/g, ' ').trim();
  const city = event.placeCity?.replace(/\s+/g, ' ').trim();
  const lines: string[] = [];
  if (line) lines.push(`Place: ${line.slice(0, 300)}`);
  if (city) lines.push(`City: ${city.slice(0, 80)}`);
  return lines;
}
