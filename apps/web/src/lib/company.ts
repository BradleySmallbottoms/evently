/** Public controller details for the privacy policy and support page. */
export const company = {
  name: 'Candy Banana AB',
  orgNumber: '556999-5813',
  street: 'Pinnarviken 319',
  postalCode: '826 91',
  city: 'Söderhamn',
  email: 'info@candybanana.se',
  phone: '070-592 55 89',
  phoneHref: 'tel:+46705925589',
  /** Calendar date the published policy text was last revised. */
  policyUpdated: '2026-11-02',
} as const;

export function formatPolicyDate(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${company.policyUpdated}T00:00:00Z`));
}
