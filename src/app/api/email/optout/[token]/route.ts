import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { appUrl } from '@/lib/app-url';
import { matchOptOutToken, recordOptOut } from '@/lib/marketing-optout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stop the lifecycle emails, in one request.
 *
 * The sibling of /api/outreach/unsubscribe, which does the same job for
 * cold outreach. This one is for people who have an account with us: the
 * welcome, the nudge and the J+14 upgrade pitch. Those went out for
 * months with no way to stop them, which is the thing this company
 * audits other people for.
 *
 * TWO METHODS, THE SAME REASONING AS THE OUTREACH ROUTE
 *
 * POST is RFC 8058 — `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * lets Gmail and Outlook show a native unsubscribe button and remove the
 * recipient without them opening anything. Since 2024 it is a condition
 * of bulk delivery, not a courtesy.
 *
 * GET is the person who clicked the footer link. It cannot be the only
 * route, because mail scanners follow links: a scanner unsubscribing
 * somebody who never read the message would be indistinguishable, in the
 * data, from a refusal.
 *
 * WHAT IT DOES NOT STOP
 *
 * Transactional mail. The audit you paid for still arrives, and the magic
 * link still signs you in. Article 21(2) is about direct marketing; it
 * does not ask us to break the account of somebody trying to use the
 * product. That is why marketing_optouts is a separate table from
 * email_suppressions, which is about whether a mailbox can be reached at
 * all.
 *
 * NEITHER METHOD REVEALS WHETHER THE TOKEN WAS REAL
 *
 * A token that matched nobody gets the same answer as one that did.
 * Otherwise this becomes an oracle for whether an address has an account
 * here — and for a compliance product, telling a stranger which companies
 * are our customers is its own kind of leak.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  await optOut(params.token, 'one_click');
  // RFC 8058 wants a bare 200; the mail client renders its own confirmation.
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  await optOut(params.token, 'link');
  // The confirmation page in the language the email was written in. An
  // Arabic email whose unsubscribe link lands on an English page undoes
  // the translation at the last step, which is the same defect the
  // localisation tests already guard against everywhere else.
  return NextResponse.redirect(`${appUrl()}/${localeFrom(request)}/unsubscribed`, { status: 303 });
}

/** The `lang` the email put on the link, or English. Validated, never echoed. */
function localeFrom(request: NextRequest): string {
  const asked = request.nextUrl.searchParams.get('lang');
  return asked && (NATIVE_LOCALE_CODES as readonly string[]).includes(asked) ? asked : 'en';
}

async function optOut(token: string, source: 'one_click' | 'link'): Promise<void> {
  if (!TOKEN.test(token)) return;

  const email = await addressFor(token);
  if (!email) return;

  await recordOptOut(email, source);
}

/**
 * Which of our recipients this token belongs to.
 *
 * An HMAC cannot be reversed, so the candidates are enumerated and each
 * is compared in constant time. The list is the authenticated users,
 * because those are the only people the lifecycle sequence writes to.
 *
 * Bounded on purpose. Pagination that runs until it stops returning rows
 * is an unbounded loop driven by a URL a stranger controls; this walks at
 * most MAX_PAGES and then gives up, which costs a rare unsubscribe a
 * retry and costs an attacker nothing worth having.
 */
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

async function addressFor(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[marketing-optout] service_credentials_missing');
    return null;
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      console.error('[marketing-optout] list_users_failed', { error: error.message });
      return null;
    }

    const emails = (data?.users ?? [])
      .map((u) => u.email)
      .filter((e): e is string => Boolean(e));

    const hit = matchOptOutToken(token, emails);
    if (hit) return hit;

    if (emails.length < PAGE_SIZE) return null;
  }

  console.warn('[marketing-optout] token_unresolved_within_bound');
  return null;
}
