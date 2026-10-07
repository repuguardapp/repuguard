import 'server-only';
import { discoverLocales } from '@/i18n/locales.server';
import { appUrl } from '@/lib/app-url';

/**
 * Build the `<link rel="alternate" hreflang>` map for a given pathname.
 *
 * Accepts a path WITHOUT locale prefix (`/`, `/pricing`, `/docs/audit-engine`)
 * and returns an object accepted by Next.js's `metadata.alternates.languages`.
 *
 * X-DEFAULT POINTS AT THE URL THAT NEGOTIATES, NOT AT ENGLISH
 *
 * It pointed at `/en`, and Search Console reported `https://lexyflow.com/en`
 * as "duplicate, Google chose a different canonical than the user". The two
 * statements we were making did not agree: the unprefixed URL answers 307 to
 * a locale chosen from Accept-Language and IP country — it IS the language
 * selector — while x-default named one particular locale as the fallback.
 * Google reconciled that by keeping the negotiating URL as canonical and
 * calling our declared one a duplicate.
 *
 * x-default is defined for exactly this: a page that does not target one
 * language, such as one that redirects by locale. That is the unprefixed
 * path, so that is what it names now.
 *
 * I cannot verify this against Google from here, and the measurement I do
 * have is the 307. The change is made because it is what x-default means,
 * not because I watched it fix the report — Search Console will say,
 * in its own time.
 */
export async function buildHreflangAlternates(
  pathWithoutLocale: string
): Promise<Record<string, string>> {
  const base = appUrl();
  const cleanPath =
    pathWithoutLocale === '/' ? '' : pathWithoutLocale.replace(/^\/+/, '/');

  const locales = await discoverLocales();
  const alternates: Record<string, string> = {};

  for (const locale of locales) {
    alternates[locale] = `${base}/${locale}${cleanPath}`;
  }
  alternates['x-default'] = `${base}${cleanPath === '' ? '/' : cleanPath}`;
  return alternates;
}
