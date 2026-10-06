import 'server-only';
import { parseFeed } from './feeds';
import { isAllowed, parseRobots } from './robots';
import { fetchExternal } from './safe-fetch';

/**
 * Who has written about our subject lately, from feeds that exist to be
 * read by machines.
 *
 * WHAT THIS REMOVES, AND WHAT IT DOES NOT
 *
 * The outreach e-mail has always been one human act with half an hour of
 * searching in front of it: open a search engine, read recent articles
 * about CNIL sanctions or international transfers, note who signed them,
 * find their public contact. That half hour is the part worth deleting,
 * and this deletes it — the machine reads the publications' own RSS
 * feeds, keeps the articles whose subject touches one of our seven
 * observations, and hands over a ranked list with the personal line
 * already drafted from the article's own title.
 *
 * It does NOT find an address and it does not send. Those two are left
 * alone deliberately and the reasons are different.
 *
 * ON THE ADDRESS: collecting professional contacts into our database
 * would make us the controller of personal data obtained from somewhere
 * other than the person, which brings Article 14 and a duty to notify
 * every one of them within a month. We deleted a harvested file once;
 * rebuilding it one row at a time with better manners is the same file.
 *
 * ON THE SENDING: this one is not a legal objection, it is that it does
 * not work. Ten identical messages leaving one mailbox in a minute are a
 * sequence, and they are read as one. The only thing that makes this
 * message land is that somebody read the recipient's article — which is
 * also the only part a machine cannot fake without lying.
 *
 * NOTHING IS STORED
 *
 * Computed on request and returned. No table, no cache, no log line
 * carrying a name. What is handled here is an article: a public document
 * with a public byline, held for the length of one page render.
 */

export interface PressFeed {
  id: string;
  /** How it is shown in the admin, so a dead feed is attributable. */
  label: string;
  url: string;
}

/**
 * Feeds to try, not feeds we know work.
 *
 * The sandbox this was written in cannot reach any of them, which is the
 * same position the observatory's ranking was in when its URL started
 * answering 404 for eight runs and nobody noticed. So every feed records
 * what it answered, the admin page prints it, and a list that has gone
 * stale says so instead of quietly returning fewer candidates.
 *
 * Deliberately small and deliberately French-facing: the study is about
 * `.fr` domains, and a byline in a publication that does not cover this
 * jurisdiction is a worse lead than no lead.
 */
export const PRESS_FEEDS: PressFeed[] = [
  { id: 'next', label: 'Next', url: 'https://next.ink/feed/' },
  { id: 'lemagit', label: 'LeMagIT', url: 'https://www.lemagit.fr/rss/toutes-les-actualites.html' },
  { id: 'zdnet-fr', label: 'ZDNet France', url: 'https://www.zdnet.fr/feeds/rss/actualites/' },
  { id: 'usine-digitale', label: "L'Usine Digitale", url: 'https://www.usine-digitale.fr/rss' },
  { id: 'lalettrea', label: 'Acteurs publics', url: 'https://acteurspublics.fr/feed' },
  { id: 'cnil', label: 'CNIL (pour le contexte)', url: 'https://www.cnil.fr/fr/rss.xml' }
];

/**
 * What makes an article a lead.
 *
 * Matched against the title and the excerpt. These are the words our
 * seven observations are about — somebody who has just written on
 * international transfers is a far better recipient than "a tech
 * journalist", because the headline figure speaks directly to what they
 * were already working on.
 */
const TOPICS: { id: string; label: string; pattern: RegExp }[] = [
  {
    id: 'transfers',
    label: 'transferts hors UE',
    pattern: /transfert[s]? (de données|hors|internationa)|clause[s]? contractuelle|privacy shield|data privacy framework|schrems/i
  },
  { id: 'cnil', label: 'sanction CNIL', pattern: /\bCNIL\b|sanction|amende|mise en demeure|délibération/i },
  { id: 'cookies', label: 'cookies et consentement', pattern: /cookie|consentement|traceur|bandeau|CMP\b/i },
  { id: 'policy', label: 'politique de confidentialité', pattern: /politique de confidentialité|mentions légales|données personnelles/i },
  { id: 'gdpr', label: 'RGPD', pattern: /\bRGPD\b|\bGDPR\b|protection des données|CEPD|EDPB/i },
  { id: 'dpo', label: 'DPO et conformité', pattern: /\bDPO\b|délégué à la protection|conformité/i }
];

/** Nothing older than this is a conversation we can still join. */
const MAX_AGE_DAYS = 180;

/** Per feed, so one prolific publication cannot fill the whole list. */
const MAX_PER_FEED = 4;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

export interface PressCandidate {
  feedId: string;
  feedLabel: string;
  title: string;
  url: string;
  publishedAt: string | null;
  /** Which of our observations the article touches, for the operator. */
  topics: string[];
  /** The personal line, drafted from the article's own title. */
  suggestedLine: string;
}

export interface FeedOutcome {
  id: string;
  label: string;
  url: string;
  /** Null when it answered. Never an empty result pretending to be one. */
  refused: string | null;
  kept: number;
}

export interface PressCandidates {
  candidates: PressCandidate[];
  /** One row per feed, including the ones that failed. */
  feeds: FeedOutcome[];
}

/**
 * Read every feed, keep what is on topic, say what each one answered.
 */
export async function findPressCandidates(): Promise<PressCandidates> {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const candidates: PressCandidate[] = [];
  const feeds: FeedOutcome[] = [];

  for (const feed of PRESS_FEEDS) {
    const outcome: FeedOutcome = { ...feed, refused: null, kept: 0 };

    try {
      const allowed = await robotsAllows(feed.url);
      if (!allowed) {
        outcome.refused = 'robots.txt nous refuse ce chemin';
        feeds.push(outcome);
        continue;
      }

      const res = await fetchExternal(feed.url, {
        headers: { 'user-agent': 'LexyFlowPressWatch/1.0 (+https://lexyflow.com)' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: 'no-store'
      });

      if (!res.ok) {
        outcome.refused = `a répondu HTTP ${res.status}`;
        feeds.push(outcome);
        continue;
      }

      const xml = (await res.text()).slice(0, MAX_BYTES);
      const parsed = parseFeed(xml);

      if (parsed.items.length === 0) {
        outcome.refused = 'aucune entrée exploitable dans le flux';
        feeds.push(outcome);
        continue;
      }

      let kept = 0;
      for (const item of parsed.items) {
        if (kept >= MAX_PER_FEED) break;

        const when = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
        if (Number.isFinite(when) && when < cutoff) continue;

        const haystack = `${item.title} ${item.excerpt ?? ''}`;
        const topics = TOPICS.filter((t) => t.pattern.test(haystack)).map((t) => t.label);
        if (topics.length === 0) continue;

        candidates.push({
          feedId: feed.id,
          feedLabel: feed.label,
          title: item.title,
          url: item.link,
          publishedAt: item.publishedAt,
          topics,
          suggestedLine: suggestLine(item.title, item.publishedAt)
        });
        kept += 1;
      }

      outcome.kept = kept;
    } catch (err) {
      outcome.refused = err instanceof Error ? err.message : String(err);
    }

    feeds.push(outcome);
  }

  // Most on-topic first, then most recent. An article matching three of
  // our observations is a better conversation than one matching one.
  candidates.sort((a, b) => {
    if (b.topics.length !== a.topics.length) return b.topics.length - a.topics.length;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });

  return { candidates, feeds };
}

/**
 * The personal line, quoting the article and nothing else.
 *
 * It names the piece and its date, because that is checkable and it is
 * what proves a human looked. It does NOT summarise the article or
 * compliment it: a machine telling a journalist what their own piece
 * argued is the exact tell that no human read it, and a flattering
 * sentence we did not mean is the kind of small lie this codebase does
 * not write.
 *
 * The operator can replace it. That is the point — it is a starting
 * line, not a finished one.
 */
function suggestLine(title: string, publishedAt: string | null): string {
  const date = publishedAt ? new Date(publishedAt) : null;
  const when =
    date && !Number.isNaN(date.getTime())
      ? ` du ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : '';
  return `Je vous écris après avoir lu « ${title.trim()} »${when}.`;
}

/** The same courtesy the crawlers observe, for the same reason. */
async function robotsAllows(target: string): Promise<boolean> {
  try {
    const url = new URL(target);
    const res = await fetchExternal(`${url.origin}/robots.txt`, {
      headers: { 'user-agent': 'LexyFlowPressWatch/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    // No robots.txt is no opinion, which the standard reads as allowed.
    if (!res.ok) return true;
    return isAllowed(url.pathname, parseRobots((await res.text()).slice(0, 100_000)));
  } catch {
    // Unreadable means unknown, and unknown means we do not read it —
    // the same rule the policy crawler follows.
    return false;
  }
}
