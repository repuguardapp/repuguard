import { randomBytes } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { capturePolicy } from '@/lib/policy-capture';
import { discoverPolicy, type Candidate } from '@/lib/policy-discovery';
import { observePolicy } from '@/lib/policy-observations';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scan a domain's published privacy policy.
 *
 * THIS ENDPOINT FETCHES SOMEBODY ELSE'S SERVER ON A STRANGER'S INSTRUCTION.
 *
 * That is the security property that shapes it. Without limits it is a free
 * scanning proxy: anyone could point it at a target and have our
 * infrastructure, our address and our reputation make the requests. So
 * there are two independent ceilings — one on the person asking, one on the
 * site being asked about — and the second one matters more, because it
 * protects a third party who never agreed to any of this.
 *
 * SSRF is handled a layer down by fetchExternal, which resolves every DNS
 * answer and refuses loopback, link-local and private ranges on every hop.
 *
 * THE RESPONSE IS IMMEDIATE, THE WORK IS NOT.
 *
 * Discovery, capture and observation take seconds against somebody else's
 * server. The visitor gets a token straight away and the pipeline runs in
 * waitUntil, because a page that hangs for ten seconds on a stranger's TLS
 * handshake is a page people close.
 */

const Body = z.object({
  // A bare domain is what a visitor types. Normalised below rather than
  // demanded in a particular form.
  domain: z.string().min(4).max(253),
  locale: z.string().min(2).max(10).default('en')
});

/**
 * How long a domain's result is reused instead of re-fetched.
 *
 * Politeness first: ten people sharing a scan link must not become ten
 * requests to that company's server. It is also honest — the result page
 * prints the fetch time, so a twelve-minute-old snapshot says so rather
 * than pretending to be live.
 */
const REUSE_WINDOW_MINUTES = 15;

export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);

  // Ceiling one: the person asking.
  if (!rateLimit({ key: `scan:ip:${ip}`, windowMs: 60 * 60 * 1000, max: 20 }).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const domain = normaliseDomain(body.domain);
  if (!domain) {
    return NextResponse.json({ error: 'not_a_domain' }, { status: 400 });
  }

  // Ceiling two: the site being asked about. Deliberately tighter than the
  // per-IP one, because it is the only limit that protects somebody who is
  // not our visitor.
  if (!rateLimit({ key: `scan:domain:${domain}`, windowMs: 60 * 60 * 1000, max: 4 }).ok) {
    return NextResponse.json({ error: 'domain_rate_limited' }, { status: 429 });
  }

  const db = supabaseService();

  // Reuse a recent result rather than knocking again.
  const { data: recent } = await db
    .from('scans')
    .select('token, status')
    .eq('domain', domain)
    .eq('status', 'done')
    .gte('created_at', new Date(Date.now() - REUSE_WINDOW_MINUTES * 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) return NextResponse.json({ token: recent.token, reused: true });

  // base64url over 18 bytes: 24 characters, inside the [A-Za-z0-9_-]{16,64}
  // shape the rest of the codebase validates tokens against. Not derived
  // from the domain — a token you can compute from a company name is not a
  // private link.
  const token = randomBytes(18).toString('base64url');

  const { data: scan, error } = await db
    .from('scans')
    .insert({ token, domain, locale: body.locale, status: 'running' })
    .select('id')
    .single();

  if (error || !scan) {
    console.error('[scan] insert_failed', { error: error?.message });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  // waitUntil, not a floating promise. Vercel freezes the function the
  // moment the response returns, and a scan that sometimes completes is a
  // result page that sometimes never leaves "running".
  waitUntil(run(scan.id, domain));

  return NextResponse.json({ token, reused: false });
}

/**
 * Discovery, capture, observation — and a written reason whenever any of
 * the three declines to produce something.
 *
 * Every exit writes a terminal status. A row left at `running` is a page
 * that spins for ever, and the visitor has no way to tell that from a slow
 * server.
 */
async function run(scanId: string, domain: string): Promise<void> {
  const db = supabaseService();

  const finish = async (patch: Record<string, unknown>) => {
    await db
      .from('scans')
      .update({ completed_at: new Date().toISOString(), ...patch })
      .eq('id', scanId);
  };

  try {
    const discovery = await discoverPolicy(domain);
    if (discovery.refused || discovery.candidates.length === 0) {
      // Phrased as a fact about our search. The document may be behind a
      // script, behind a login, or on a path we did not try, and "this
      // company has no privacy policy" is not ours to say.
      return void (await finish({ status: 'failed', failure: discovery.refused ?? 'no candidate' }));
    }

    // Try candidates in order. The homepage's own link comes first because
    // it is the site's answer to the question; a conventional path is our
    // guess and is only reached if the site pointed at nothing.
    let captured: Awaited<ReturnType<typeof capturePolicy>>['capture'] = null;
    let candidate: Candidate | null = null;
    let lastRefusal = 'no candidate could be read';

    for (const option of discovery.candidates.slice(0, 3)) {
      const attempt = await capturePolicy(option.url);
      if (attempt.capture) {
        captured = attempt.capture;
        candidate = option;
        break;
      }
      lastRefusal = attempt.refused ?? lastRefusal;
    }

    if (!captured || !candidate) {
      return void (await finish({ status: 'failed', failure: lastRefusal }));
    }

    const { data: snapshot, error: snapshotError } = await db
      .from('scan_snapshots')
      .insert({
        scan_id: scanId,
        url: captured.url,
        provenance: candidate.provenance,
        content_hash: captured.contentHash,
        content_type: captured.contentType,
        byte_length: captured.byteLength,
        text_length: captured.text.length,
        fetched_at: captured.fetchedAt
      })
      .select('id')
      .single();

    if (snapshotError || !snapshot) {
      return void (await finish({ status: 'failed', failure: 'could not record the document' }));
    }

    const observations = observePolicy(captured.text);

    // The safety net, and it exists because the first one failed.
    //
    // airbnb.com passed capture and produced seven blanks, which the page
    // then published about a named company that plainly does have a
    // detailed privacy policy. A genuine policy answers at least one of
    // these seven questions; seven blanks is far more likely to be our
    // failure than the document's content, and publishing them is the
    // error this whole design exists to prevent.
    if (!observations.some((o) => o.finding === 'present')) {
      return void (await finish({
        status: 'failed',
        failure: 'read a page, but none of the seven observations could be established — it does not look like a privacy policy'
      }));
    }

    if (observations.length > 0) {
      await db.from('scan_observations').insert(
        observations.map((o) => ({
          snapshot_id: snapshot.id,
          observation: o.id,
          finding: o.finding,
          // Only a `present` finding has a span, and the module guarantees
          // it. Evidence for an absence would be evidence of nothing.
          evidence: o.evidence ?? null
        }))
      );
    }

    await finish({ status: 'done', failure: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scan] pipeline_threw', { scanId, error: message });
    // Still terminal. The one thing this function must never do is leave
    // the row running.
    await finish({ status: 'failed', failure: 'the scan did not complete' });
  }
}

/**
 * Turn what a visitor typed into a hostname.
 *
 * People paste a full URL with a tracking parameter, the bare host in
 * capitals, and the www form with a trailing space. All three mean the same
 * site, and treating them as three different scans would triple the
 * requests we make to it.
 *
 * No illustrative `example.com` in this comment on purpose: a guard test
 * forbids that string anywhere in src, because sitemap.ts once carried it
 * as a fallback origin and published 360 URLs under it.
 */
export function normaliseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let host: string;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }

  // A hostname, not an IP address: an IP has no published privacy policy
  // and scanning one on request is the shape of a port scanner.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  if (host.endsWith('.local') || host === 'localhost') return null;

  return host.startsWith('www.') ? host.slice(4) : host;
}
