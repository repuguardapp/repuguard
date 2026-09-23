import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { type ReactNode } from 'react';
import { PostHogProvider } from '@/lib/analytics-client';
import { LanguageSelector } from '@/components/LanguageSelector';
import { Lexymark } from '@/components/Lexymark';
import { HeaderAuth } from '@/components/HeaderAuth';
import { Link } from '@/i18n/navigation';
import { getLocaleDescriptor, NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { discoverLocales } from '@/i18n/locales.server';
import { buildHreflangAlternates } from '@/lib/hreflang';

export async function generateStaticParams() {
  return NATIVE_LOCALE_CODES.map((locale) => ({ locale }));
}

/**
 * NOT dynamic, and that is the point.
 *
 * This layout used to force per-request rendering, so that the session
 * helper could see the request cookies and the header could show
 * "My dashboard" instead of "Sign in". The comment beside it said that
 * nested pages were "still prerendered — only the layout shell becomes
 * dynamic". That was false. `dynamic` on a layout applies to the whole
 * segment beneath it: the build reported 524 static pages and wrote ONE
 * html file to disk. Every page of the site was rendering on demand, with
 * a Supabase round-trip for the session, so that two buttons in the corner
 * could be right on the first paint.
 *
 * The header now asks /api/auth/state from the browser instead — see
 * components/HeaderAuth.tsx, which states the cost — and the pages that
 * genuinely need the request (dashboard, admin, the API) opt themselves
 * out individually, which is where that decision belongs.
 *
 * `generateStaticParams` above enumerates the locales; nothing else here
 * reads the request, so this subtree prerenders. A guard test in
 * tests/locale-layout-static.test.ts holds that — asserted against the
 * source text, including in comments, which is why this note names no
 * identifier.
 */

interface LayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { locale } = params;
  setRequestLocale(locale);
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

  setRequestLocale(locale);
  const messages = await getMessages();
  const descriptor = getLocaleDescriptor(locale);
  const tNav = await getTranslations('nav');
  const tFooter = await getTranslations('footer');
  const tHubs = await getTranslations('hubs');

  // Tolt affiliate tracker — fetched async, sets the tolt_referral
  // cookie when a visitor arrives via an affiliate link
  // (?ref=PARTNER_ID). The cookie is read server-side by
  // /api/checkout and stamped onto Stripe Subscription metadata so
  // Tolt's independent webhook listener can attribute commissions.
  // No-op when NEXT_PUBLIC_TOLT_ID is unset, so this is safe to ship
  // before signing up for Tolt.
  const toltId = process.env.NEXT_PUBLIC_TOLT_ID;

  // No nonce on the tag below, and none read here.
  //
  // Reading the request headers is a dynamic API: it would opt this
  // subtree out of static rendering just as surely as reading the session
  // cookie did, and it would do it for a script that is often not even
  // rendered.
  //
  // The tag does not need one. Our CSP lists https://cdn.tolt.io in
  // script-src by host — it has to, because a nonce covers the tag we
  // write and not the requests that script then makes for its own assets
  // — and there is no 'strict-dynamic' in the policy, so the host
  // allowlist is honoured. The nonce was redundant with the host entry
  // that was already carrying it.

  return (
    <html lang={descriptor.code} dir={descriptor.direction}>
      <head>
        {toltId && (
          <script
            async
            src="https://cdn.tolt.io/tolt.js"
            data-tolt={toltId}
          />
        )}
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <PostHogProvider>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
            <div className="container flex h-16 items-center justify-between gap-4">
              <Link href="/" className="inline-flex items-center gap-2">
                <Lexymark className="h-6 w-6" />
                <span className="text-base font-semibold tracking-tight">LexyFlow</span>
              </Link>

              <nav className="flex items-center gap-4 text-sm md:gap-6">
                <Link
                  href="/pricing"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tNav('pricing')}
                </Link>
                <Link
                  href="/docs"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {tNav('docs')}
                </Link>
              </nav>

              <div className="flex items-center gap-2">
                <LanguageSelector />
                <HeaderAuth />
              </div>
            </div>
          </header>

          <main className="container">{children}</main>

          <footer className="border-t">
            {/* The resource row is not decoration. Google's URL
                inspection said of every /compliance and /compare page:
                "no referring page detected". The header and footer
                linked to /, /audit, /dashboard, /docs, /dpa, /login,
                /pricing, /privacy and /terms, and nowhere else — so 329
                pages had no inbound link from anywhere on the site and
                Google declined to index a single one of them. A sitemap
                is a hint; a link is a path. This is the path, and it is
                in the footer because the footer is on every page. */}
            <div className="container flex flex-wrap justify-center gap-x-6 gap-y-2 border-b py-6 text-sm sm:justify-start">
              <span className="font-medium text-foreground">{tHubs('footerResources')}</span>
              <Link href="/compliance" className="text-muted-foreground hover:text-foreground">
                {tHubs('seeAll')}
              </Link>
              <Link href="/compare" className="text-muted-foreground hover:text-foreground">
                {tHubs('seeComparisons')}
              </Link>
              <Link href="/decisions" className="text-muted-foreground hover:text-foreground">
                {tHubs('seeDecisions')}
              </Link>
              {/* The free tool, linked from every page for the reason the
                  rest of this row exists: 329 pages once sat on this site
                  with no inbound link from anywhere on it, and Google
                  treated them accordingly. */}
              <Link href="/scan" className="text-muted-foreground hover:text-foreground">
                {tHubs('seeScan')}
              </Link>
            </div>
            <div className="container flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row">
              <span>{tFooter('copyright', { year: new Date().getFullYear() })}</span>
              <div className="flex flex-wrap gap-6">
                <Link href="/privacy" className="hover:text-foreground">{tFooter('privacy')}</Link>
                <Link href="/terms" className="hover:text-foreground">{tFooter('terms')}</Link>
                <Link href="/dpa" className="hover:text-foreground">{tFooter('dpa')}</Link>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
