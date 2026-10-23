import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { DM_Sans, Geist_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { ColorScheme } from '@/components/color-scheme';
import { SentryProvider } from '@/components/sentry-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { routing } from '@/i18n/routing';
import { QueryProvider } from '@/lib/query-provider';
import './globals.css';

export const instant = false;

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

const colorSchemeScript = `try{document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches)}catch(e){}`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${dmSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorSchemeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ColorScheme />
        <TooltipProvider>
          <NextIntlClientProvider messages={messages}>
            <SentryProvider>
              <QueryProvider>
                <Suspense fallback={<div className="min-h-full bg-background" />}>
                  <AdminShell>{children}</AdminShell>
                </Suspense>
              </QueryProvider>
            </SentryProvider>
          </NextIntlClientProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
