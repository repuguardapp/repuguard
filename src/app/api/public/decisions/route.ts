import { NextResponse } from 'next/server';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { listPublishedDecisions, type PublishedDecision } from '@/lib/legal-decisions';
import { appUrl } from '@/lib/app-url';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';

/**
 * The decisions that are safe to republish, as a feed.
 *
 * WHY THIS EXISTS INSTEAD OF A QUERY INSIDE A MAKE SCENARIO
 *
 * The operator wants a daily post built from this corpus. The obvious
 * way is to let the automation read the database and fill a template.
 * That is the version that eventually publishes "GOOGLE LLC — CNIL —
 * clôture" as though it were a fine, to a platform where a correction
 * does not travel with the original.
 *
 * It is not a hypothetical. The extraction engine returned
 * "clôture de l'injonction prononcée à l'encontre de SOLOCAL" as an
 * `order`: the regulator said the company had COMPLIED and we were one
 * step from publishing it as a sanction, under its name, in seven
 * languages. The fix was to derive the outcome in code rather than
 * trust a label. A template in a scenario nobody reviews undoes that.
 *
 * So the rule lives here, on our side, in one place, under test. The
 * automation consumes a list it cannot widen.
 *
 * WHAT IS ADMITTED, AND WHY EACH CONDITION
 *
 *   outcome ∈ {fine, reprimand, order}
 *     An authority imposed something. `closed`, `guidance`,
 *     `court_ruling` and `other` are excluded — a closure is good news
 *     for the organisation and reads as the opposite when a post
 *     strips it to a name and a label.
 *
 *   entity present
 *     A sanction is always against somebody. An Article 65 binding
 *     decision between two supervisory authorities is not an order
 *     against a company, and we published one as such once already.
 *
 *   status = published
 *     A human approved these exact words in the review queue. Nothing
 *     reaches here that a person has not read.
 *
 * Natural persons are excluded upstream: the extractor rejects them
 * outright since 22 October, and all 42 rows currently admitted were
 * read by hand that day — companies, councils, police forces,
 * hospitals, a school, an electoral commission. None is a person.
 *
 * EVERY ITEM CARRIES ITS SOURCE
 *
 * `primaryUrl` is the regulator's own page and `url` is our summary of
 * it. A post built from this cannot state an amount without being able
 * to show where it came from, which is the house rule this feed exists
 * to keep enforceable at a distance.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Outcomes where an authority imposed something. `closed` is never here. */
const PUBLISHABLE = new Set(['fine', 'reprimand', 'order']);

/** Enough for a daily scenario to dedupe against, small enough to stay cheap. */
const MAX_ITEMS = 50;
const DEFAULT_ITEMS = 20;

/**
 * Generous, because this is public data an automation polls on a
 * schedule, and tight enough that it is not a scraping surface.
 */
const IP_LIMIT = { windowMs: 60 * 60 * 1000, max: 60 };

export async function GET(request: Request) {
  const ip = clientIpFrom(request.headers);
  const limit = rateLimit({ key: `public-decisions:${ip}`, ...IP_LIMIT });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', resetAt: limit.resetAt },
      { status: 429, headers: { 'cache-control': 'no-store' } }
    );
  }

  const params = new URL(request.url).searchParams;

  // An unknown locale falls back rather than 404s: a scenario that
  // mistypes `fr-FR` should get French-shaped English, not an outage.
  const asked = params.get('locale') ?? 'en';
  const locale = (NATIVE_LOCALE_CODES as readonly string[]).includes(asked) ? asked : 'en';

  const requested = Number(params.get('limit') ?? DEFAULT_ITEMS);
  const count = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_ITEMS)
    : DEFAULT_ITEMS;

  // Read wide, filter here. The filter is the product of this route and
  // it must not be expressible as a query parameter.
  const all = await listPublishedDecisions(locale, 200);
  if (all === null) {
    // Never an empty list on a failed read: a scenario that posts
    // "nothing today" because the database blinked is a scenario that
    // lies quietly.
    return NextResponse.json(
      { error: 'unavailable', detail: 'The corpus could not be read just now.' },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }

  const base = appUrl();
  const items = all
    .filter(
      (d: PublishedDecision) =>
        PUBLISHABLE.has(d.outcome ?? '') && Boolean(d.entity && d.entity.trim())
    )
    .slice(0, count)
    .map((d: PublishedDecision) => ({
      id: d.id,
      entity: d.entity,
      authority: d.authority,
      outcome: d.outcome,
      decisionDate: d.decisionDate,
      // Both fields or neither — a bare number with no currency is how
      // a £963,900 penalty became "963 900 €" once.
      fineAmount: d.fineCurrency ? d.fineAmount : null,
      fineCurrency: d.fineAmount !== null ? d.fineCurrency : null,
      articles: d.articles,
      title: d.title,
      summary: d.summary,
      /** The regulator's own page. Every post must be able to show this. */
      primaryUrl: d.primaryUrl,
      /** Our summary of it, in the requested language. */
      url: `${base}/${locale}/decisions/${d.slug}`
    }));

  return NextResponse.json(
    {
      locale,
      count: items.length,
      /**
       * Stated in the payload, not only in this file, so that whoever
       * wires the scenario reads it without opening the repository.
       */
      excludes:
        'closures, guidance, court rulings, decisions with no named organisation, and natural persons',
      items
    },
    {
      headers: {
        // Five minutes at the edge: a daily scenario never sees a stale
        // list, and a retry loop costs one read instead of fifty.
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    }
  );
}
