const KR_AMOUNT = /(\d{1,7}(?:[ \u00a0]\d{3})*)\s*kr(?![\p{L}])/giu;
const FREE = /(?<![\p{L}])(?<!inte\s)(?<!ej\s)gratis(?![\p{L}])/iu;
const MAX_MAJOR = 100_000;

/**
 * SEK minor units from an explicit price in text.
 * A stated amount in kr wins. Otherwise a standalone "gratis" is free.
 * Anything else stays unknown. The public list treats unknown as free.
 */
export function priceAmountFromText(text: string | null | undefined): number | undefined {
  if (!text?.trim()) return undefined;
  const amounts: number[] = [];
  for (const match of text.matchAll(KR_AMOUNT)) {
    const major = Number(match[1]!.replace(/[ \u00a0]/g, ''));
    if (!Number.isSafeInteger(major) || major < 0 || major > MAX_MAJOR) continue;
    amounts.push(major * 100);
  }
  const positive = amounts.filter((amount) => amount > 0);
  if (positive.length > 0) return Math.min(...positive);
  if (amounts.includes(0) || FREE.test(text)) return 0;
  return undefined;
}

/** List filter: unknown and 0 are free. A positive amount is paid. */
export function matchesListPrice(
  amount: number | null | undefined,
  price: 'free' | 'paid',
): boolean {
  if (price === 'paid') return amount != null && amount > 0;
  return amount == null || amount === 0;
}

/** Compact card label for a known price, such as `100kr`. Free and unknown stay blank. */
export function krPriceLabel(amount: number | null | undefined): string | null {
  if (amount == null || amount <= 0) return null;
  const major = amount / 100;
  const text = Number.isInteger(major)
    ? String(major)
    : String(Math.round(major * 100) / 100).replace('.', ',');
  return `${text}kr`;
}
