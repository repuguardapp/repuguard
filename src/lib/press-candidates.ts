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
  /**
   * Whether anybody signs what this feed publishes.
   *
   * THIS FIELD EXISTS BECAUSE THE LIST WAS USELESS WITHOUT IT
   *
   * The CNIL's feed was here "for context" and it competed in the same
   * ranked list as the publications. It won every time, by construction:
   * a regulator's press release trips four of the topic patterns below —
   * CNIL, RGPD, politique de confidentialité, conformité — where a
   * journalist writing about one of them trips two. With four items kept
   * per feed, the institutional releases floated to the top and buried
   * the signed articles underneath them.
   *
   * The operator opened the page, saw press releases, and correctly
   * concluded there was nobody to write to. The signed articles were
   * there; the ranking had pushed them below the fold.
   *
   * An institutional feed can never yield a contactable human — there is
   * no byline, only the institution — so it has no business in a list
   * whose entire purpose is finding one. It is kept, polled and reported
   * for feed health, and it produces no candidates.
   */
  kind: 'press' | 'institution';
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
  { id: 'next', label: 'Next', url: 'https://next.ink/feed/', kind: 'press' },
  {
    id: 'lemagit',
    label: 'LeMagIT',
    url: 'https://www.lemagit.fr/rss/toutes-les-actualites.html',
    kind: 'press'
  },
  {
    id: 'zdnet-fr',
    label: 'ZDNet France',
    url: 'https://www.zdnet.fr/feeds/rss/actualites/',
    kind: 'press'
  },
  {
    id: 'usine-digitale',
    label: "L'Usine Digitale",
    url: 'https://www.usine-digitale.fr/rss',
    kind: 'press'
  },
  // The id said `lalettrea` and the label said Acteurs publics. A feed
  // whose id names a different publication than its label cannot be
  // attributed when it dies, which is the one job the id has.
  {
    id: 'acteurs-publics',
    label: 'Acteurs publics',
    url: 'https://acteurspublics.fr/feed',
    kind: 'press'
  },
  // Added because five feeds was too thin to pace an outreach on, and a
  // thin list looks exactly like a quiet field. None of these has been
  // reached from here — this sandbox has no network — so they are
  // candidates, in the same sense the ranking sources are: each one
  // records what it answered and the admin prints it, so a URL that is
  // wrong says so instead of quietly returning nothing.
  { id: 'numerama', label: 'Numerama', url: 'https://www.numerama.com/feed/', kind: 'press' },
  {
    id: 'lmi',
    label: 'Le Monde Informatique',
    url: 'https://www.lemondeinformatique.fr/flux-rss/thematique/toutes-les-actualites/rss.xml',
    kind: 'press'
  },
  { id: 'silicon', label: 'Silicon.fr', url: 'https://www.silicon.fr/feed', kind: 'press' },
  // Polled for feed health and for nothing else: it has no byline, so it
  // can never produce somebody to write to.
  {
    id: 'cnil',
    label: 'CNIL (contexte, sans signature)',
    url: 'https://www.cnil.fr/fr/rss.xml',
    kind: 'institution'
  }
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
const TOPICS: { id: string; label: string; weight: number; pattern: RegExp }[] = [
  {
    id: 'transfers',
    label: 'transferts hors UE',
    /**
     * Weighted, not counted.
     *
     * The first sort was by how MANY topics an article matched, which
     * rewarded breadth and buried the one article that mattered: a piece
     * about international transfers speaks directly to the headline
     * figure — 14 of 106 — while `RGPD`, `CNIL` and `conformité` match
     * roughly everything published on this beat and say nothing about
     * fit. Counting them made a generic news round-up outrank the
     * specialist.
     */
    weight: 4,
    pattern: /transfert[s]? (de données|hors|internationa)|clause[s]? contractuelle|privacy shield|data privacy framework|schrems/i
  },
  {
    id: 'policy',
    label: 'politique de confidentialité',
    weight: 3,
    pattern: /politique de confidentialité|mentions légales|données personnelles/i
  },
  {
    id: 'cookies',
    label: 'cookies et consentement',
    weight: 2,
    pattern: /cookie|consentement|traceur|bandeau|CMP\b/i
  },
  {
    id: 'cnil',
    label: 'sanction CNIL',
    weight: 1,
    pattern: /\bCNIL\b|sanction|amende|mise en demeure|délibération/i
  },
  { id: 'gdpr', label: 'RGPD', weight: 1, pattern: /\bRGPD\b|\bGDPR\b|protection des données|CEPD|EDPB/i },
  { id: 'dpo', label: 'DPO et conformité', weight: 1, pattern: /\bDPO\b|délégué à la protection|conformité/i }
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
  /** How well it fits, weighted by observation rather than counted. */
  fit: number;
  /** The personal line, drafted from the article's own title. */
  suggestedLine: string;
}

export interface FeedOutcome {
  id: string;
  label: string;
  url: string;
  kind: PressFeed['kind'];
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
        const matched = TOPICS.filter((t) => t.pattern.test(haystack));
        if (matched.length === 0) continue;

        // An institutional feed is polled so its health is reported, and
        // its items are never offered as somebody to write to: there is
        // no byline behind them.
        if (feed.kind === 'institution') continue;

        candidates.push({
          feedId: feed.id,
          feedLabel: feed.label,
          title: item.title,
          url: item.link,
          publishedAt: item.publishedAt,
          topics: matched.map((t) => t.label),
          fit: matched.reduce((sum, t) => sum + t.weight, 0),
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

  // Best fit first, then most recent. By weight and not by how many
  // patterns tripped: somebody who has just written about international
  // transfers is a far better conversation than somebody whose piece
  // happens to contain the words RGPD, CNIL and conformité.
  candidates.sort((a, b) => {
    if (b.fit !== a.fit) return b.fit - a.fit;
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
