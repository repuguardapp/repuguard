import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkDomainTxt, verificationToken } from '@/lib/domain-verification';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check whether a domain publishes our TXT record, and record it if so.
 *
 * This endpoint grants one thing: it makes /scan/<domain> indexable. That
 * is the only irreversible-ish consequence in the whole scan feature — it
 * puts a named company into search results under our analysis — so it is
 * also the only one gated on proof rather than on asking.
 *
 * The scan token in the body identifies which result the caller is looking
 * at. It does NOT authorise anything: the authorisation is the DNS record,
 * and somebody who guessed a token still cannot publish a record in a zone
 * they do not administer.
 *
 * VERIFICATION IS NEVER REMOVED HERE.
 *
 * A domain that stops publishing the record keeps its verification. Taking
 * it away would mean the page silently leaves Google because somebody
 * tidied a DNS zone — and, worse, it would let a lapsed record be read as
 * a change of mind that nobody actually expressed. Un-verifying is a
 * deliberate act, on request, and it belongs somewhere a person has to ask
 * for it.
 */

const Body = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)
});

export async function POST(request: NextRequest) {
  // DNS lookups are cheap but not free, and this endpoint takes a domain
  // from a stranger. Tighter than the scan itself: verifying is something
  // you do once, not something you poll.
  const ip = clientIpFrom(request.headers);
  if (!rateLimit({ key: `verify:ip:${ip}`, windowMs: 60 * 60 * 1000, max: 30 }).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const db = supabaseService();

  const { data: scan } = await db
    .from('scans')
    .select('domain')
    .eq('token', body.token)
    .maybeSingle();

  if (!scan) return NextResponse.json({ error: 'unknown_scan' }, { status: 404 });

  const domain = scan.domain as string;

  // Fails closed and names the variable. A verification that silently
  // accepted anything would grant indexing of other people's names, which
  // is the one thing here that cannot be undone by a deploy.
  if (!verificationToken(domain)) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const result = await checkDomainTxt(domain);

  if (!result.verified) {
    // 200, not an error status. The record usually has not propagated yet,
    // and that is the expected first answer rather than a failure of the
    // request. The reason travels so the page can say which it was.
    return NextResponse.json({ verified: false, reason: result.reason ?? 'not found' });
  }

  const { error } = await db.from('domain_verifications').upsert(
    {
      domain,
      txt_record: result.matched ?? '',
      txt_name: `_lexyflow.${domain}`,
      verified_at: new Date().toISOString()
    },
    { onConflict: 'domain' }
  );

  if (error) {
    console.error('[verify] write_failed', { error: error.message });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  console.log('[verify] domain_verified', { domain });
  return NextResponse.json({ verified: true });
}
