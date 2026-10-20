import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ColorScheme } from '@/components/color-scheme';
import { SentryProvider } from '@/components/sentry-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { routing } from '@/i18n/routing';
import './globals.css';

export const instant = false;

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
    <html lang={locale} className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorSchemeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ColorScheme />
        <TooltipProvider>
          <NextIntlClientProvider messages={messages}>
            <SentryProvider>{children}</SentryProvider>
          </NextIntlClientProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
