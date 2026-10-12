import { priceAmountFromText, matchesListPrice, krPriceLabel } from '../../../packages/domain/src/price';
import { describe, expect, it } from 'vitest';

describe('priceAmountFromText', () => {
  it('reads gratis as free and an amount in kr as öre', () => {
    expect(priceAmountFromText('Gratis. Du behöver ingen biljett.')).toBe(0);
    expect(priceAmountFromText('Avgift: 1600 kr, faktureras')).toBe(160_000);
    expect(priceAmountFromText('Övriga betalar endast 100kr (inklusive fika)')).toBe(10_000);
    expect(priceAmountFromText('Inträde 100 kr inklusive fika')).toBe(10_000);
    expect(priceAmountFromText('Pris 1 600 kr')).toBe(160_000);
  });

  it('keeps a paid amount when the text also says gratis', () => {
    expect(priceAmountFromText('Gratis för medlemmar, övriga 50 kr')).toBe(5_000);
  });

  it('does not treat an unknown description as free or paid', () => {
    expect(priceAmountFromText('ideella krafter och samhälle')).toBeUndefined();
    expect(priceAmountFromText('inte gratis')).toBeUndefined();
    expect(priceAmountFromText('')).toBeUndefined();
    expect(priceAmountFromText(null)).toBeUndefined();
  });
});

describe('matchesListPrice', () => {
  it('treats an unknown price as free and a positive amount as paid', () => {
    expect(matchesListPrice(null, 'free')).toBe(true);
    expect(matchesListPrice(undefined, 'free')).toBe(true);
    expect(matchesListPrice(0, 'free')).toBe(true);
    expect(matchesListPrice(10_000, 'free')).toBe(false);
    expect(matchesListPrice(null, 'paid')).toBe(false);
    expect(matchesListPrice(10_000, 'paid')).toBe(true);
  });
});

describe('krPriceLabel', () => {
  it('formats a card price as kronor without a space', () => {
    expect(krPriceLabel(10_000)).toBe('100kr');
    expect(krPriceLabel(160_000)).toBe('1600kr');
    expect(krPriceLabel(0)).toBeNull();
    expect(krPriceLabel(null)).toBeNull();
  });
});
