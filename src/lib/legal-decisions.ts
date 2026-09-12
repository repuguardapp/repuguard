import 'server-only';
import { FRAMEWORKS, type LegalFramework } from './legal-frameworks';
import { supabaseService } from './supabase';

/**
 * Read access to the published legal-watch corpus.
 *
 * Read through the service client because legal_developments has RLS
 * on with no policies — nothing but the server may touch it. That is
 * deliberate: rows spend most of their life in `discovered`,
 * `extracted` or `rejected`, and none of those has been reviewed by a
 * person. Only `published` is publishable, and filtering for it lives
 * here rather than at each call site so a new page cannot forget.
 */

export interface PublishedDecision {
  id: string;
  slug: string;
  title: string;
  summary: string;
  primaryUrl: string;
  sourceName: string;
  sourceLicence: string;
  authority: string | null;
  decisionDate: string | null;
  articles: string[];
  fineEur: number | null;
  outcome: string | null;
  /** Frameworks this decision bears on, resolved from its source. */
  frameworks: LegalFramework[];
}

interface Row {
  id: string;
  slug: string | null;
  primary_url: string;
  authority: string | null;
  decision_date: string | null;
  articles: string[] | null;
  fine_eur: number | null;
  outcome: string | null;
  legal_sources: { name: string; licence: string; framework_ids: string[] | null } | null;
  legal_development_locales: { locale: string; title: string; summary: string }[] | null;
}

const SELECT =
  'id, slug, primary_url, authority, decision_date, articles, fine_eur, outcome, ' +
  'legal_sources(name, licence, framework_ids), ' +
  'legal_development_locales(locale, title, summary)';

/**
 * Shape one row for one locale, or null when it cannot be shown.
 *
 * Returns null rather than falling back to English when the locale is
 * missing. Pass 3 publishes all seven languages or none, so a gap here
 * means something is wrong — and serving English under an /ar/ URL
 * would be duplicate content competing with our own /en page, which is
 * exactly what the all-or-nothing rule upstream exists to prevent.
 */
function shape(row: Row, locale: string): PublishedDecision | null {
  if (!row.slug) return null;
  const text = (row.legal_development_locales ?? []).find((l) => l.locale === locale);
  if (!text) return null;

  const ids = row.legal_sources?.framework_ids ?? [];
  return {
    id: row.id,
    slug: row.slug,
    title: text.title,
    summary: text.summary,
    primaryUrl: row.primary_url,
    sourceName: row.legal_sources?.name ?? 'Source',
    sourceLicence: row.legal_sources?.licence ?? '',
    authority: row.authority,
    decisionDate: row.decision_date,
    articles: row.articles ?? [],
    fineEur: row.fine_eur,
    outcome: row.outcome,
    frameworks: ids
      .map((id) => FRAMEWORKS.find((f) => f.id === id))
      .filter((f): f is LegalFramework => Boolean(f))
  };
}

/** Published decisions, newest first, for the index page and sitemap. */
export async function listPublishedDecisions(
  locale: string,
  limit = 50
): Promise<PublishedDecision[]> {
  const { data, error } = await supabaseService()
    .from('legal_developments')
    .select(SELECT)
    .eq('status', 'published')
    .order('decision_date', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    // An index that renders empty is better than one that 500s, but a
    // silently empty index is how a broken corpus goes unnoticed.
    console.error('[legal-decisions] list_failed', { error: error.message });
    return [];
  }

  return ((data ?? []) as unknown as Row[])
    .map((row) => shape(row, locale))
    .filter((d): d is PublishedDecision => d !== null);
}

/** One decision by slug, or null — the page calls notFound() on null. */
export async function getPublishedDecision(
  slug: string,
  locale: string
): Promise<PublishedDecision | null> {
  const { data, error } = await supabaseService()
    .from('legal_developments')
    .select(SELECT)
    .eq('status', 'published')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return shape(data as unknown as Row, locale);
}

/**
 * Every published slug — the sitemap needs these and nothing else.
 *
 * Never throws. The sitemap is one route covering ~360 URLs, and
 * supabaseService() throws outright when the service key is absent —
 * which is the normal state of a build machine. Letting that escape
 * failed the entire production build on a corpus that was empty
 * anyway. A sitemap short of a few pages is recoverable; a sitemap
 * that throws takes the deploy with it.
 */
export async function listPublishedSlugs(): Promise<string[]> {
  let result;
  try {
    result = await supabaseService()
      .from('legal_developments')
      .select('slug')
      .eq('status', 'published')
      .not('slug', 'is', null)
      .limit(5000);
  } catch (err) {
    console.error('[legal-decisions] slugs_unavailable', {
      error: err instanceof Error ? err.message : String(err)
    });
    return [];
  }
  const { data, error } = result;

  if (error) {
    console.error('[legal-decisions] slugs_failed', { error: error.message });
    return [];
  }
  return ((data ?? []) as { slug: string | null }[])
    .map((r) => r.slug)
    .filter((s): s is string => Boolean(s));
}

/**
 * Deep link into the audit form with this decision's frameworks already
 * ticked.
 *
 * This is what turns a reference page into the top of the funnel: a
 * reader who has just seen a regulator fine someone under GDPR Art. 13
 * is one click from checking their own policy against GDPR, with the
 * box already selected rather than a form to fill in from scratch.
 */
export function auditHrefFor(decision: PublishedDecision): string {
  if (decision.frameworks.length === 0) return '/audit';
  const ids = decision.frameworks.map((f) => f.id).join(',');
  return `/audit?frameworks=${encodeURIComponent(ids)}`;
}
