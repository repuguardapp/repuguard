import type { MetadataRoute } from 'next';
import { discoverLocales } from '@/i18n/locales.server';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import { CURATED_PAIRS } from '@/lib/seo-routes';

/**
 * Multilingual sitemap. Each canonical path is emitted once with an
 * `alternates.languages` map. Search engines pick the right URL per market.
 *
 * Three families are surfaced:
 *
 *   • Core marketing pages (home, pricing, audit, docs).
 *
 *   • Programmatic SEO single-framework deep-dives — one entry per
 *     framework (13) cross-multiplied by locales (7) = 91 URLs.
 *
 *   • Programmatic SEO comparison pairs — curated list of ~38 pairs
 *     cross-multiplied by locales = ~266 URLs.
 *
 * Search Console caps a single sitemap at 50 000 URLs and 50 MB. We
 * sit comfortably under both even after the programmatic expansion,
 * so a single file is fine; if we ever cross the 50 000 line we'd
 * shard into sitemap-core.xml / sitemap-compliance.xml /
 * sitemap-compare.xml and ship a sitemap index.
 */
const CORE_ROUTES = ['', '/pricing', '/audit', '/docs', '/trust', '/sample-report'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://example.com';
  const locales = await discoverLocales();
  const now = new Date();
  const langMap = (path: string): Record<string, string> =>
    Object.fromEntries(locales.map((alt) => [alt, `${base}/${alt}${path}`]));

  const core = CORE_ROUTES.flatMap((path) =>
    locales.map((locale) => ({
      url: `${base}/${locale}${path}`,
      lastModified: now,
      alternates: { languages: langMap(path) }
    }))
  );

  const frameworkPages = FRAMEWORKS.flatMap((f) =>
    locales.map((locale) => ({
      url: `${base}/${locale}/compliance/${f.id}`,
      lastModified: now,
      // Comparison + framework pages don't change often once shipped,
      // so we hint Google to crawl them weekly rather than daily.
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      alternates: { languages: langMap(`/compliance/${f.id}`) }
    }))
  );

  const comparisonPages = CURATED_PAIRS.flatMap((pair) =>
    locales.map((locale) => ({
      url: `${base}/${locale}/compare/${pair}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
      alternates: { languages: langMap(`/compare/${pair}`) }
    }))
  );

  return [...core, ...frameworkPages, ...comparisonPages];
}
