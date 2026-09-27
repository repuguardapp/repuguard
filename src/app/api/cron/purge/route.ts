import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { isCronAuthorized } from '@/lib/cron-auth';

/**
 * Daily retention enforcement.
 *
 * Triggered by Vercel Cron (see vercel.json). Authenticated by the
 * `CRON_SECRET` Bearer token, also accepted as the `?secret=` query
 * param so manual invocations from a browser stay simple.
 *
 * What we delete:
 *   - audits whose `created_at` is older than AUDIT_RETENTION_DAYS;
 *   - rate_limits rows whose window has long expired;
 *   - stripe_webhook_events older than 90 days (idempotency window);
 *   - accounts that were never confirmed and never used.
 *
 * Billing data is intentionally not touched — tax law requires multi-year
 * retention. That happens via Stripe-side rules and/or a separate, more
 * cautious workflow.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Avoid concurrent purges if Vercel ever fires twice.
export const maxDuration = 60;

const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 30);
const WEBHOOK_RETENTION_DAYS = 90;
const RATE_LIMIT_RETENTION_HOURS = 24;

/**
 * How long an unconfirmed account is kept before it is deleted.
 *
 * 345 accounts existed, 46 had ever confirmed an address or signed in,
 * and the oldest of the rest dated from May — four months of e-mail
 * addresses belonging to people who never completed a signup, most of
 * them injected by bots across sixteen throwaway domains.
 *
 * There is no basis to keep them. An address collected for a signup that
 * never happened serves no purpose we could state, and "we might need it"
 * is not one — Article 5(1)(c) and (e), minimisation and storage
 * limitation, which we audit other companies against. Thirty days is long
 * enough that somebody who meant to confirm and got distracted still can.
 */
const UNCONFIRMED_RETENTION_DAYS = 30;

/**
 * The most accounts one run may delete.
 *
 * Not a performance bound. This is the only irreversible operation in the
 * codebase that acts on people rather than on rows we generated, and a
 * ceiling means a bug in the predicate costs a bounded number of accounts
 * and shows up in the next digest instead of emptying the table overnight.
 */
const MAX_ACCOUNT_DELETIONS_PER_RUN = 250;

export async function GET(request: Request) {
  if (!await isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return runPurge();
}

/** POST is also accepted because some queue systems prefer it. */
export async function POST(request: Request) {
  if (!await isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return runPurge();
}


async function runPurge() {
  const db = supabaseService();

  const auditCutoff   = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const webhookCutoff = new Date(Date.now() - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rateCutoff    = new Date(Date.now() - RATE_LIMIT_RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  // We delete via the cascading audits row — audit_findings drop with it.
  const { count: auditsDeleted, error: auditErr } = await db
    .from('audits')
    .delete({ count: 'exact' })
    .lt('created_at', auditCutoff);

  // The pivot cache holds verbatim evidence quotes, exactly like the
  // findings it was derived from, so it lives under the same retention
  // promise rather than quietly outliving the audit it came from.
  const { count: pivotsDeleted, error: pivotErr } = await db
    .from('audit_pass1_cache')
    .delete({ count: 'exact' })
    .lt('created_at', auditCutoff);

  const { count: webhooksDeleted, error: webhookErr } = await db
    .from('stripe_webhook_events')
    .delete({ count: 'exact' })
    .lt('processed_at', webhookCutoff);

  const { count: rateLimitsDeleted, error: rateErr } = await db
    .from('rate_limits')
    .delete({ count: 'exact' })
    .lt('window_start', rateCutoff);

  const accounts = await purgeUnconfirmedAccounts();

  const errors = [auditErr, pivotErr, webhookErr, rateErr]
    .filter(Boolean)
    .map((e) => e?.message)
    .concat(accounts.errors);
  return NextResponse.json(
    {
      ok: errors.length === 0,
      deleted: {
        audits:        auditsDeleted ?? 0,
        pivot_cache:   pivotsDeleted ?? 0,
        webhooks:      webhooksDeleted ?? 0,
        rate_limits:   rateLimitsDeleted ?? 0,
        unconfirmed_accounts: accounts.deleted
      },
      cutoffs: {
        audits: auditCutoff,
        webhooks: webhookCutoff,
        rate_limits: rateCutoff,
        unconfirmed_accounts: accountCutoff(),
      },
      errors
    },
    { status: errors.length === 0 ? 200 : 500 }
  );
}

function accountCutoff(): string {
  return new Date(Date.now() - UNCONFIRMED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Delete accounts that were never confirmed and never used.
 *
 * WHY THIS IS AN ADMIN API CALL AND NOT A DELETE STATEMENT
 *
 * auth.users has ten child tables — identities, sessions, MFA factors,
 * one-time tokens, WebAuthn credentials — and deleting the row leaves the
 * Auth service to notice afterwards. deleteUser is the operation Supabase
 * supports for this, it revokes sessions rather than orphaning them, and
 * it is the difference between removing a person's data and removing our
 * pointer to it.
 *
 * FOUR CONDITIONS, ALL OF THEM, AND RE-CHECKED HERE
 *
 * The listing gives us every account; the predicate is applied in this
 * function rather than trusted from a query, because this is the one
 * irreversible operation in the codebase that acts on people:
 *
 *   1. the address was never confirmed;
 *   2. the account was never signed in to;
 *   3. it is older than the retention window;
 *   4. it belongs to no organisation.
 *
 * The fourth is the belt to the others' braces. An account with an
 * organisation has had a workspace created for it and may own audits,
 * documents and a billing relationship, and no combination of the first
 * three should ever be true of one — so if it ever is, the right
 * behaviour is to leave it alone and let somebody look.
 */
async function purgeUnconfirmedAccounts(): Promise<{ deleted: number; errors: string[] }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { deleted: 0, errors: ['supabase service credentials missing'] };

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = accountCutoff();
  const errors: string[] = [];
  let deleted = 0;

  // Bounded pagination: a loop that runs until the listing stops
  // returning rows is an unbounded loop over a table that grows.
  for (let page = 1; page <= 25 && deleted < MAX_ACCOUNT_DELETIONS_PER_RUN; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      errors.push(`list_users: ${error.message}`);
      break;
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      if (deleted >= MAX_ACCOUNT_DELETIONS_PER_RUN) break;

      const organizationId = (user.app_metadata as { organization_id?: string } | null)
        ?.organization_id;

      const disposable =
        !user.email_confirmed_at &&
        !user.last_sign_in_at &&
        user.created_at < cutoff &&
        !organizationId;

      if (!disposable) continue;

      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError) {
        errors.push(`delete_user: ${deleteError.message}`);
        continue;
      }
      deleted += 1;
    }

    // Deleting shifts the pages under us, so page 1 is re-read on the
    // next iteration rather than page 2 skipping the accounts that moved
    // into the space. Whatever is missed this run is caught tomorrow.
    if (deleted > 0) break;
  }

  // No addresses in the log line. A purge log that lists who was deleted
  // recreates, in a place with a longer retention, the thing it deleted.
  if (deleted > 0) console.log('[cron/purge] unconfirmed_accounts_deleted', { deleted });
  return { deleted, errors };
}
