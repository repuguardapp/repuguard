import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { describeFeed, parseFeed } from '@/lib/feeds';
import { describeListing, parseListing } from '@/lib/listing';
import { supabaseService } from '@/lib/supabase';
import { fetchExternal } from '@/lib/safe-fetch';

/**
 * Legal watch — the intake of the Acquisition brain.
 *
 * Polls the regulator feeds in `legal_sources` and records what it
 * finds in `legal_developments` as `discovered`. It does nothing else:
 * no extraction, no translation, no publishing. Intake that also
 * interprets is intake you cannot debug.
 *
 * Idempotent by construction — (source_id, external_id) is unique, so
 * the same item found on a hundred consecutive runs inserts once. That
 * is what lets this run every six hours without any cursor state.
 *
 * What it stores is deliberately thin: an id, a link to the primary
 * source, a date, and the feed's own title and excerpt as extraction
 * INPUT. Source prose is never rendered and never indexed. Facts are
 * not copyrightable; a regulator's paragraphs are.
 *
 * Per-source isolation is the point of the loop: a regulator who moves
 * a URL, serves HTML instead of XML, or goes down must cost us that
 * source for one run, never the others. The failure is written onto
 * the source row so it is visible in one query rather than inferred
 * from an absence of rows — the failure mode this whole codebase keeps
 * relearning.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Feeds are small; anything slower than this is a source that is down.
 *
 * 20s rather than 15s because the CNIL — the source that has never failed
 * — timed out on a run where it had simply been slow. A transient timeout
 * costs a real source a strike against the five that disable it, so the
 * budget has to be generous enough that only a genuinely dead endpoint
 * spends one.
 */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Probes are speculative, so they get a fraction of the real budget: four
 * of them at 4s is 16s on top of a 20s fetch, inside a 60-second function.
 */
const PROBE_TIMEOUT_MS = 4_000;

/** And a ceiling on the whole search, whatever the list grows to. */
const PROBE_BUDGET_MS = 20_000;

/**
 * Newest N entries per source per run. Regulator feeds carry 20-50
 * items and we poll four times a day, so this is never a limit in
 * steady state — it is a bound on the first run against a fat feed.
 */
const MAX_ITEMS_PER_SOURCE = 40;

/**
 * Consecutive failures before a source switches itself off.
 *
 * A feed that no longer exists would otherwise alert four times a day,
 * for ever. That is how an alerting channel stops being read, and it
 * would discredit the alerts that matter alongside it — the ICO
 * withdrew every one of its RSS feeds pending a redesign, so ours was
 * never coming back.
 *
 * Five runs is a day and a quarter: long enough that a regulator's
 * maintenance window or a bad afternoon does not disable anything,
 * short enough that a genuinely dead feed goes quiet within two days.
 * Re-enabling is deliberate, which is right — a dead feed returns only
 * when somebody has found its replacement.
 */
const DISABLE_AFTER_CONSECUTIVE_FAILURES = 5;

/**
 * The same rule for a source that has never worked at all.
 *
 * A source that broke and a source that was never right are opposite
 * situations, and five runs is the wrong answer to the second. We sell
 * audits against six Gulf regimes and watch none of them; adding those
 * authorities means adding URLs nobody here can open, because the build
 * sandbox reaches no regulator domain. The first honest description of
 * such a source is "candidate", and a candidate would be switched off
 * about thirty hours later — less time than it takes to read what the
 * prober found and try the next path. Every Gulf source would be dead
 * before it had taught us anything.
 *
 * Twenty runs is five days: several probe reports, several corrections,
 * and still a bounded life for a URL that is simply wrong.
 */
const DISABLE_UNVERIFIED_AFTER = 20;

interface SourceRow {
  id: string;
  name: string;
  feed_url: string;
  feed_kind: string;
  item_pattern: string | null;
  licence: string;
  consecutive_failures: number | null;
  /** First poll that produced items. Null means it has never worked. */
  verified_at: string | null;
}

interface SourceResult {
  source: string;
  ok: boolean;
  discovered: number;
  skipped: number;
  error?: string;
  /** True while the source has never once produced an item: a candidate. */
  unverified?: boolean;
  /** Set when this run was the one that switched the source off. */
  disabled?: boolean;
}

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return watch();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return watch();
}

async function watch() {
  const db = supabaseService();

  const { data, error } = await db
    .from('legal_sources')
    .select(
      'id, name, feed_url, feed_kind, item_pattern, licence, consecutive_failures, verified_at'
    )
    .eq('enabled', true);

  if (error) {
    console.error('[cron/watch-legal] sources_unreadable', { error: error.message });
    alertOps('cron.watch_legal_sources_unreadable', { error: error.message });
    return NextResponse.json({ error: 'sources_unreadable', detail: error.message }, { status: 500 });
  }

  const sources = (data ?? []) as SourceRow[];

  // Concurrently, not one after another.
  //
  // Nine sources at a 20-second budget each is three minutes of worst
  // case against a 60-second function: the sources polled last would
  // simply never be polled, and — because a source that is never reached
  // is not a source that failed — nothing anywhere would say so. The
  // slowest regulator would silently decide how much of Europe we watch.
  //
  // Nine parallel GETs to nine different authorities is not load on any
  // of them; the whole run is now bounded by the slowest single fetch.
  const results = await Promise.all(
    sources.map(async (source): Promise<SourceResult> => {
      try {
        return await pollSource(db, source);
      } catch (err) {
        // pollSource handles its own failures; this is the one it did not
        // anticipate, and one source must never cost us the other eight.
        const message = err instanceof Error ? err.message : String(err);
        console.error('[cron/watch-legal] source_threw', { source: source.id, error: message });
        return { source: source.id, ok: false, discovered: 0, skipped: 0, error: message };
      }
    })
  );

  const failed = results.filter((r) => !r.ok);
  const discovered = results.reduce((n, r) => n + r.discovered, 0);

  // A candidate that fails is not news.
  //
  // A source that stops reporting looks exactly like a regulator having a
  // quiet month, and only the alert tells the two apart — but that is a
  // statement about sources which once worked. A Gulf authority added with
  // a URL nobody here could open is EXPECTED to fail, probably several
  // times, while the prober narrows it down. Alerting on that trains us to
  // ignore the channel, which costs far more than the six sources it is
  // reporting on.
  const brokenAlerts = failed.filter((f) => !f.unverified);

  if (failed.length > 0) {
    console.warn('[cron/watch-legal] sources_failed', {
      broken: brokenAlerts.map((f) => f.source),
      candidates: failed.filter((f) => f.unverified).map((f) => f.source)
    });
  }
  if (brokenAlerts.length > 0) {
    alertOps('cron.watch_legal_source_failed', {
      failed: brokenAlerts.map((f) => ({ source: f.source, error: f.error }))
    });
  }
  if (discovered > 0) {
    console.log('[cron/watch-legal] discovered', { discovered });
  }

  return NextResponse.json({ ok: failed.length === 0, discovered, results });
}

/**
 * Ask the regulator's own server where its feed lives.
 *
 * The ICO and Brazil's ANPD both build their listings in the browser: the
 * HTML a crawler receives genuinely does not contain the decisions, so no
 * `item_pattern` can read them and the repair is a different URL. Finding
 * one meant guessing from a build sandbox that cannot reach a single
 * regulator domain — one guess per six-hour run, each costing a day, each
 * verified only by a red badge the next morning.
 *
 * The production function has the network access the sandbox does not. So
 * on failure — and only on failure — it tries the handful of paths that
 * publishing platforms conventionally use, and writes down what came back.
 * gov.br runs Plone, whose feeds sit at `<section>/RSS`; WordPress and Drupal
 * answer at `/feed`; most sites keep something at `/rss.xml`.
 *
 * A SOURCE THAT HAS NEVER WORKED GETS A WIDER SEARCH
 *
 * For a Gulf authority added from outside with a URL nobody could open,
 * the failure is usually the listing path itself, and probing for feeds
 * beside a 404 answers a question we are not asking. So an unverified
 * source also gets the conventional places a government site keeps its
 * news, and the report carries how many same-origin links each page
 * holds — which is what says whether a page is built on the server or in
 * the browser, the distinction that has cost us the ICO and the ANPD.
 *
 * DELIBERATELY SMALL AND POLITE
 *
 * Sequential, four seconds each, under a hard twenty-second budget for the
 * whole search, and never while a source is healthy. A working source
 * probes nothing. Anything more enthusiastic than this is a crawler, and
 * we are a subscriber — the difference matters to the people whose pages
 * these are, and to whether they keep answering us at all.
 */
async function probeCandidates(feedUrl: string, unverified = false): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(feedUrl);
  } catch {
    return null;
  }

  const stem = base.pathname.replace(/\/+$/, '');
  const paths = [`${stem}/RSS`, `${stem}/feed`, `${stem}/rss.xml`, '/rss.xml'];
  if (unverified) {
    paths.push('/en/news', '/news', '/en/media-center/news', '/en/media-centre/news');
  }

  // One budget for the whole search rather than one per request, so the
  // list can grow without anyone having to recompute whether the function
  // still fits inside its sixty seconds.
  const deadline = Date.now() + PROBE_BUDGET_MS;

  // First, ask for something that cannot exist.
  //
  // SDAIA and the Garante both answered 200 to every path the prober tried
  // — /RSS, /feed and /rss.xml each returning the same page — and the
  // report duly listed three feeds that were one web page. A single-page
  // application serving its shell for any URL makes every finding below
  // meaningless, and a report that cannot tell a discovery from a catch-all
  // is worse than no report: it is four confident wrong answers a morning.
  //
  // A random path is unguessable and uncacheable, so a 200 here proves the
  // server answers anything. One extra request, only on a source that has
  // already failed.
  const canary = `/${crypto.randomUUID()}`;
  if (await answersAnything(new URL(canary, base.origin).toString())) {
    return `site answers 200 to ${canary} — catch-all, no path here can be trusted`;
  }

  const findings: string[] = [];
  for (const path of paths) {
    if (Date.now() > deadline) {
      findings.push('(budget spent)');
      break;
    }

    const candidate = new URL(path, base.origin).toString();
    if (candidate === feedUrl) continue;

    try {
      const res = await fetchExternal(candidate, {
        headers: {
          'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)',
          accept:
            'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8'
        },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: 'no-store'
      });

      // A 404 is the common answer and is not worth reporting; it is the
      // absence of news. What matters is a path that exists.
      if (!res.ok) continue;

      // 200 is not enough: a site that answers every URL with its homepage
      // would report four feeds and have none.
      const head = (await res.text()).slice(0, 60_000);

      // For a page, the same-origin link count is the one number that
      // matters: it says whether the list is rendered on the server or
      // assembled in the browser. The ICO's enforcement page answers 200
      // with 38 links and not a decision among them, and no pattern will
      // ever read it.
      const shape = /<(rss|feed)\b/i.test(head.slice(0, 500))
        ? describeFeed(head)
        : describeListing(head, { itemPattern: '/', baseUrl: candidate });

      // The byte count distinguishes three different pages from one page
      // served three times, which is what the Garante's report looked like
      // before the canary above existed to explain it.
      findings.push(`${path} → ${head.length}B ${shape}`);
    } catch {
      // A probe that times out tells us nothing and must cost nothing.
    }
  }

  return findings.length > 0 ? findings.join(' ; ') : null;
}

/**
 * Does this server answer 200 to a URL that cannot exist?
 *
 * Kept separate from the probe loop because its failure mode is the
 * opposite one: here an error, a timeout or any non-200 is the GOOD answer
 * — it means the site distinguishes between paths, so what the probe finds
 * afterwards means something. Only a clean 200 is disqualifying.
 */
async function answersAnything(url: string): Promise<boolean> {
  try {
    const res = await fetchExternal(url, {
      headers: { 'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store'
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pollSource(
  db: ReturnType<typeof supabaseService>,
  source: SourceRow
): Promise<SourceResult> {
  const stamp = async (patch: Record<string, unknown>) => {
    await db
      .from('legal_sources')
      .update({ last_polled_at: new Date().toISOString(), ...patch })
      .eq('id', source.id);
  };

  /**
   * Record a failure, and switch the source off once it has failed
   * often enough that it is not coming back on its own.
   */
  const fail = async (error: string): Promise<SourceResult> => {
    const streak = (source.consecutive_failures ?? 0) + 1;
    // A source that broke and a source that was never right are opposite
    // situations, and the five-run rule answers only the first.
    const unverified = !source.verified_at;
    const limit = unverified ? DISABLE_UNVERIFIED_AFTER : DISABLE_AFTER_CONSECUTIVE_FAILURES;
    const giveUp = streak >= limit;
    await stamp({
      last_status: 'error',
      last_error: error,
      consecutive_failures: streak,
      ...(giveUp
        ? {
            enabled: false,
            disabled_reason: unverified
              ? `Never produced an item in ${streak} polls. The URL is probably wrong and the probe findings in last_error are where to look next.`
              : `Auto-disabled after ${streak} consecutive failures. Last error: ${error}`
          }
        : {})
    });
    if (giveUp) {
      console.warn('[cron/watch-legal] source_auto_disabled', {
        source: source.id,
        streak,
        unverified,
        error
      });
      // Said once, at the moment it happens. After this the source is
      // disabled and silent — which is the whole point. A candidate that
      // never worked still says so here: giving up on a jurisdiction we
      // sell audits against is worth one line, even when each individual
      // failure was not.
      alertOps('cron.watch_legal_source_disabled', { source: source.id, streak, unverified, error });
    }
    return {
      source: source.id,
      ok: false,
      discovered: 0,
      skipped: 0,
      error,
      unverified,
      ...(giveUp ? { disabled: true } : {})
    };
  };

  let body: string;
  try {
    const res = await fetchExternal(source.feed_url, {
      // Identify ourselves. A regulator blocking an anonymous scraper
      // is entirely reasonable, and a contactable user agent is the
      // difference between being rate-limited and being banned.
      headers: {
        'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)',
        // The EDPS answers 403. A request with no Accept header is a
        // signature several WAFs treat as a bot worth refusing, and
        // stating what we came for costs nothing. If it is still 403
        // after this, they mean it and the source goes.
        accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8',
        'accept-language': 'en;q=0.9'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) {
      const candidates = await probeCandidates(source.feed_url, !source.verified_at);
      return await fail(`http_${res.status}${candidates ? ` | candidates: ${candidates}` : ''}`);
    }
    body = await res.text();
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  // Two kinds of source, one pipeline past this point.
  //
  // RSS is the exception, not the rule: the ICO withdrew every one of
  // its feeds, the Gulf authorities never had any, and Brazil and Japan
  // publish news pages. A watcher that only speaks RSS is a watcher
  // that can only ever cover Europe — on a product selling audits
  // against thirteen frameworks.
  const { items, skipped } =
    source.feed_kind === 'html'
      ? parseListing(body, {
          itemPattern: source.item_pattern ?? '/',
          baseUrl: source.feed_url
        })
      : parseFeed(body);

  if (items.length === 0) {
    // Reaching a URL that yields nothing usable is a failure, not a
    // quiet day: it is what a moved feed serving an HTML redirect page
    // looks like. Saying "ok, 0 items" here is how a dead source stays
    // dead for months. For a listing it also catches the other failure
    // — the page is alive and item_pattern no longer matches anything,
    // because the regulator reorganised their URLs.
    // Say what was on the page, not only that nothing was taken from it.
    // "skipped 8, 138832 bytes" is true and cannot be acted on: it does
    // not distinguish a pattern that matches nothing from a pattern that
    // matches links whose anchors carry no text, and those need opposite
    // repairs. The diagnosis has to travel in the error, because the only
    // other way to get it is to open the regulator's page by hand.
    const seen =
      source.feed_kind === 'html'
        ? describeListing(body, {
            itemPattern: source.item_pattern ?? '/',
            baseUrl: source.feed_url
          })
        : describeFeed(body);

    // And go looking for the feed this source should have been.
    //
    // The ICO and the ANPD both build their listings in the browser, so
    // there is no pattern that reads them — the page a crawler receives
    // genuinely does not contain the decisions. The repair is a different
    // URL, and finding one meant guessing from a sandbox that cannot reach
    // a single regulator domain: one guess per six-hour run, each costing
    // a day. The production system can simply look.
    const candidates = await probeCandidates(source.feed_url, !source.verified_at);

    return await fail(
      `no_items (kind=${source.feed_kind}, skipped ${skipped}, ${body.length} bytes) — ${seen}${
        candidates ? ` | candidates: ${candidates}` : ''
      }`
    );
  }

  const rows = items.slice(0, MAX_ITEMS_PER_SOURCE).map((item) => ({
    source_id: source.id,
    external_id: item.externalId,
    primary_url: item.link,
    published_at: item.publishedAt,
    raw_title: item.title,
    raw_excerpt: item.excerpt,
    status: 'discovered'
  }));

  // ignoreDuplicates leans on the (source_id, external_id) unique key:
  // already-known items are left exactly as they are, including any
  // review a human has since done to them. An upsert that overwrote
  // would silently reset an approved item back to the feed's wording.
  const { data: inserted, error: insertErr } = await db
    .from('legal_developments')
    .upsert(rows, { onConflict: 'source_id,external_id', ignoreDuplicates: true })
    .select('id');

  if (insertErr) return await fail(insertErr.message);

  // A success clears the streak: an intermittent feed must never creep
  // up to the threshold over weeks of alternating runs.
  // The count, not only the colour. `items.length > 0` is all "ok" has
  // ever meant, and the ICO spent this pipeline's entire existence green
  // on one row that was its accessibility skip link. A source reporting
  // ok on one item is usually harvesting furniture; "ok, 8" and "ok, 1"
  // are visibly different claims, and only one of them needs looking at.
  await stamp({
    last_status: 'ok',
    last_error: null,
    consecutive_failures: 0,
    last_item_count: items.length,
    // The moment this source stopped being a candidate. Written once and
    // never again: from here on a failure means something changed, and the
    // ordinary five-run rule applies.
    ...(source.verified_at ? {} : { verified_at: new Date().toISOString() })
  });
  return {
    source: source.id,
    ok: true,
    discovered: (inserted ?? []).length,
    skipped
  };
}
