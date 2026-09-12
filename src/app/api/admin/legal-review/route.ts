import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/lib/admin';
import { alertOps } from '@/lib/alert';
import { supabaseService } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/supabase-server';

/**
 * The editorial gate of the Acquisition brain.
 *
 * Everything upstream is automatic: feeds are polled, facts are
 * extracted, nothing is interpreted. This is the one step a person
 * performs, and it is where responsibility for a public statement
 * transfers from a model to us.
 *
 * Approving does not publish — it clears the item for localisation and
 * publication. The distinction matters because an approver is agreeing
 * that the facts match the primary source, not proofreading six
 * translations that do not exist yet.
 *
 * Guarded by the ADMIN_EMAILS allowlist, which is empty by default:
 * with no allowlist configured nobody is an admin, so a missing env var
 * closes the gate rather than opening it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  developmentId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional()
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdminEmail(user.email)) {
    // Deliberately the same answer for "not signed in" and "signed in
    // but not an admin": the existence of the queue is not something a
    // logged-in stranger needs confirmed.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_request', detail: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const db = supabaseService();
  const now = new Date().toISOString();

  const patch =
    body.action === 'approve'
      ? { status: 'approved', reviewed_at: now, rejected_reason: null, updated_at: now }
      : {
          status: 'rejected',
          reviewed_at: now,
          rejected_reason: body.reason?.trim() || 'rejected in review',
          updated_at: now
        };

  // The status guard is what makes a double-click harmless and what
  // stops a stale tab from re-deciding an item someone already handled.
  const { data, error } = await db
    .from('legal_developments')
    .update(patch)
    .eq('id', body.developmentId)
    .eq('status', 'extracted')
    .select('id');

  if (error) {
    console.error('[admin/legal-review] write_failed', { error: error.message });
    alertOps('admin.legal_review_write_failed', {
      developmentId: body.developmentId,
      error: error.message
    });
    return NextResponse.json({ error: 'write_failed', detail: error.message }, { status: 500 });
  }

  if ((data ?? []).length === 0) {
    // Not an error worth alerting on — the commonest cause is two tabs.
    return NextResponse.json({ ok: false, reason: 'already_reviewed' }, { status: 409 });
  }

  console.log('[admin/legal-review] reviewed', {
    developmentId: body.developmentId,
    action: body.action,
    by: user.email
  });

  return NextResponse.json({ ok: true, status: patch.status });
}
