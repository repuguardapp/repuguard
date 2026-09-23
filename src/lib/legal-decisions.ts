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
  /**
   * The summary cut to a length that fits a card, at a word boundary.
   *
   * The index used `line-clamp-3`, which clips whatever falls past the
   * third line. In Arabic that landed inside a Latin number run and
   * rendered "21 يوليو 026" — the year 2026 with its first digit
   * clipped away, on a page whose whole claim is factual accuracy.
   * Cutting in the server, between words, cannot split a number.
   */
  excerpt: string;
  primaryUrl: string;
  sourceName: string;
  sourceLicence: string;
  authority: string | null;
  /** Organisation sanctioned. Null for guidance and opinions. */
  entity: string | null;
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
  entity: string | null;
  decision_date: string | null;
  articles: string[] | null;
  fine_eur: number | null;
  outcome: string | null;
  legal_sources: { name: string; licence: string; framework_ids: string[] | null } | null;
  legal_development_locales: { locale: string; title: string; summary: string }[] | null;
}

const SELECT =
  'id, slug, primary_url, authority, entity, decision_date, articles, fine_eur, outcome, ' +
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
    excerpt: excerpt(text.summary),
    primaryUrl: row.primary_url,
    sourceName: row.legal_sources?.name ?? 'Source',
    sourceLicence: row.legal_sources?.licence ?? '',
    authority: row.authority,
    entity: row.entity,
    decisionDate: row.decision_date,
    articles: row.articles ?? [],
    fineEur: row.fine_eur,
    outcome: row.outcome,
    frameworks: ids
      .map((id) => FRAMEWORKS.find((f) => f.id === id))
      .filter((f): f is LegalFramework => Boolean(f))
  };
}

/** Characters of summary a card shows before the ellipsis. */
const EXCERPT_CHARS = 240;

/**
 * Cut at the last space before the limit, never mid-token.
 *
 * Works the same in every script: Japanese and Arabic summaries are
 * spaced prose here, and a language with no spaces would simply fall
 * back to the hard cut, which is still a whole grapheme cluster
 * because we are slicing a JavaScript string by code unit on a
 * boundary we then trim.
 */
function excerpt(summary: string): string {
  if (summary.length <= EXCERPT_CHARS) return summary;
  const cut = summary.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Published decisions, newest first, for the index page and sitemap. */
/**
 * Returns the published decisions, or null when we could not read them.
 *
 * Null is not an empty list, and the distinction is the whole reason this
 * signature is not `PublishedDecision[]`. Its own predecessor said it in
 * a comment — "a silently empty index is how a broken corpus goes
 * unnoticed" — and then returned `[]` for both cases anyway, so the page
 * printed "no decisions yet" whether there were none or whether the
 * database was unreachable. One of those is a fact about our corpus and
 * the other is a fact about our connection, and only the first is ours to
 * state.
 *
 * It also has to survive a database that is not there at all. This is now
 * called during the build: `supabaseService()` throws on missing
 * credentials rather than returning an error, which took the whole export
 * down for seven locales. A deploy that fails because a database had a
 * bad minute is a deploy schedule owned by the database.
 */
export async function listPublishedDecisions(
  locale: string,
  limit = 50
): Promise<PublishedDecision[] | null> {
  let result;
  try {
    result = await supabaseService()
      .from('legal_developments')
      .select(SELECT)
      .eq('status', 'published')
      .order('decision_date', { ascending: false, nullsFirst: false })
      .limit(limit);
  } catch (err) {
    console.error('[legal-decisions] list_unavailable', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }

  const { data, error } = result;

  if (error) {
    console.error('[legal-decisions] list_failed', { error: error.message });
    return null;
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
export async function listPublishedSlugs(): Promise<{ slug: string; updatedAt: string | null }[]> {
  let result;
  try {
    result = await supabaseService()
      .from('legal_developments')
      .select('slug, updated_at')
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
  return ((data ?? []) as { slug: string | null; updated_at: string | null }[])
    .filter((r): r is { slug: string; updated_at: string | null } => Boolean(r.slug))
    .map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
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
