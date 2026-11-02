import { describe, expect, it } from 'vitest';
import en from '../../../apps/web/src/messages/en.json';
import sv from '../../../apps/web/src/messages/sv.json';
import { company, formatPolicyDate } from '../../../apps/web/src/lib/company';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('store legal pages', () => {
  it('keeps the Swedish and English legal copy on the same keys', () => {
    expect(leafKeys(sv.Legal).sort()).toEqual(leafKeys(en.Legal).sort());
  });

  it('names a reachable controller', () => {
    expect(company.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(company.phoneHref.startsWith('tel:+')).toBe(true);
    expect(company.orgNumber).toBe('556999-5813');
    expect(formatPolicyDate('sv')).toMatch(/2026/);
    expect(formatPolicyDate('en')).toMatch(/2026/);
  });
});
