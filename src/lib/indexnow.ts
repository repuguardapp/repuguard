import 'server-only';
import { appUrl } from '@/lib/app-url';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';

/**
 * IndexNow — telling Bing and Yandex a page exists, the moment it does.
 *
 * WHY THIS ONE AND NOT A DIRECTORY SCRIPT
 *
 * The operator asked for automated submission to SaaS directories.
 * Those forbid it in their terms and enforce it with anti-bot
 * measures, and this repository does not defeat other people's bot
 * mitigation — the same rule it applied to its own database guard.
 *
 * IndexNow is the opposite case. It is a protocol the search engines
 * published specifically so that sites can submit URLs by machine.
 * Using it as intended is not a workaround; it is the door.
 *
 * It is also honest about its limits: Google does not participate. So
 * this moves Bing and Yandex and says nothing about the 427 URLs
 * sitting in Google's "Discovered – currently not indexed". Those are
 * a crawl-budget problem that no ping solves.
 *
 * THE KEY IS NOT A SECRET, AND THAT IS BY DESIGN
 *
 * IndexNow authorises a submission by requiring the key to be hosted
 * at the domain it claims. Knowing it buys an attacker nothing unless
 * they can also serve files from lexyflow.com. So it lives in the
 * repository rather than in an environment variable: a value that must
 * be published to work is not a credential, and pretending otherwise
 * would mean one more variable to lose.
 */
export const INDEXNOW_KEY = 'a7f3c21e9b5d4e08a1c6f2b7d9e4a308';

/** Where the engines will look for it. Served by app/[key].txt/route.ts. */
export function indexNowKeyPath(): string {
  return `/${INDEXNOW_KEY}.txt`;
}

/**
 * One endpoint, not four.
 *
 * api.indexnow.org forwards to every participating engine. Submitting
 * to each of them separately is the same URLs four times and four
 * failure modes to handle.
 */
const ENDPOINT = 'https://api.indexnow.org/IndexNow';

/** Their documented ceiling per request. */
const MAX_URLS = 10_000;

export interface SubmitResult {
  ok: boolean;
  submitted: number;
  status?: number;
  error?: string;
}

/**
 * Submit paths, expanded across every locale.
 *
 * Takes locale-less paths (`/decisions/acme-fined-abc123`) because the
 * caller publishes a decision, not seven URLs, and forgetting a locale
 * is the kind of omission nobody notices — six languages would simply
 * be slower to appear and no instrument would say why.
 *
 * NEVER THROWS
 *
 * It is called from the publication cron, after the rows are written.
 * A search engine being unreachable must not fail a run that has
 * already done its work, and must not make the cron look broken in the
 * digest. It returns the failure and logs it; the sitemap still
 * carries every URL, so the worst case is that Bing finds them on its
 * own schedule instead of ours.
 */
export async function submitToIndexNow(paths: string[]): Promise<SubmitResult> {
  const base = appUrl();
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return { ok: false, submitted: 0, error: `unusable app url: ${base}` };
  }

  const urlList = [...new Set(paths)]
    .flatMap((path) => NATIVE_LOCALE_CODES.map((locale) => `${base}/${locale}${path}`))
    .slice(0, MAX_URLS);

  if (urlList.length === 0) return { ok: true, submitted: 0 };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${base}${indexNowKeyPath()}`,
        urlList
      }),
      cache: 'no-store'
    });

    // 200 and 202 both mean accepted; 422 means they disagree about the
    // host or the key and is worth seeing rather than swallowing.
    const ok = res.status === 200 || res.status === 202;
    if (!ok) {
      console.error('[indexnow] rejected', { status: res.status, urls: urlList.length });
    }
    return { ok, submitted: ok ? urlList.length : 0, status: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[indexnow] unreachable', { error });
    return { ok: false, submitted: 0, error };
  }
}
