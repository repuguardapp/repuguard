import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { type ReactNode } from 'react';
import { LanguageSelector } from '@/components/LanguageSelector';
import { discoverLocales, getLocaleDescriptor, NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { buildHreflangAlternates } from '@/lib/hreflang';

export async function generateStaticParams() {
  return NATIVE_LOCALE_CODES.map((locale) => ({ locale }));
}

interface LayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { locale } = params;
  unstable_setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'meta' });
  const alternates = await buildHreflangAlternates('/');
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      canonical: `/${locale}`,
      languages: alternates
    }
  };
}

export default async function LocaleLayout({ children, params: { locale } }: LayoutProps) {
  const available = await discoverLocales();
  if (!available.includes(locale.toLowerCase())) notFound();

  unstable_setRequestLocale(locale);
  const messages = await getMessages();
  const descriptor = getLocaleDescriptor(locale);

  return (
    <html lang={descriptor.code} dir={descriptor.direction}>
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <header className="flex items-center justify-between px-6 py-4 border-b">
            <div className="font-semibold tracking-tight">RepuGuard Compliance</div>
            <LanguageSelector />
          </header>
          <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
