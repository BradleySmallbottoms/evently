import type { ReactNode } from 'react';
import { company } from '@/lib/company';

const linkClass = 'text-foreground underline underline-offset-4 hover:underline';

export function companyMessageValues() {
  return {
    name: company.name,
    orgNumber: company.orgNumber,
    street: company.street,
    postalCode: company.postalCode,
    city: company.city,
    email: company.email,
    phone: company.phone,
  };
}

export function MailLink(chunks: ReactNode) {
  return (
    <a href={`mailto:${company.email}`} className={linkClass}>
      {chunks}
    </a>
  );
}
