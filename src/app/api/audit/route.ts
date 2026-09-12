import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { logAccess } from '@/lib/access-log';
import { alertOps } from '@/lib/alert';
import { captureServerEvent } from '@/lib/analytics';
import { extractText } from '@/lib/document-extractor';
import { encryptDocument } from '@/lib/document-crypto';
import { runMultiPassAudit } from '@/lib/multi-pass-engine';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase';
import { getCurrentUser, organizationIdFromUser } from '@/lib/supabase-server';
import { FREE_TIER_MAX_BYTES, getTierForOrg } from '@/lib/tier';
import { hashDocument, wipeBuffer } from '@/lib/zero-knowledge';
import { FRAMEWORKS, type FrameworkId } from '@/lib/legal-frameworks';

/**
 * Asynchronous audit endpoint — accept, answer, then work.
 *
 * The caller POSTs the document and the audit metadata. Everything
 * that can be decided quickly is decided on the request: validation,
 * the org guard, rate limits, the credit gate, text extraction, and a
 * check for an identical report we have already produced. Then the
 * audit row is opened as 'running', the caller gets a 202 with its id,
 * and the minutes-long part runs on after the response.
 *
 * It used to hold the connection open for the whole pipeline, behind
 * an NDJSON stream that emitted a whitespace heartbeat every ten
 * seconds — because iOS Safari and some carrier proxies abort a fetch
 * that transmits nothing for about a minute. That kept the browser
 * happy and solved nothing underneath: a closed tab, a phone going to
 * sleep or a dropped connection still destroyed an audit the customer
 * had already paid for, and the report only existed once the request
 * survived to its end.
 *
 * Now the audit belongs to the database from the moment it is paid
 * for. The customer can close the tab and come back to it.
 *
 * The contract this buys, and the reason the row is opened first:
 * every audit reaches a terminal status. The background pipeline
 * writes one on every path it can reach; the polling endpoint heals a
 * row abandoned past 15 minutes; the reaper sweeps at 20 what was
 * never polled at all. All three refund.
 *
 * Why we run on the Node.js runtime (not Edge):
 *   • pdf-parse + mammoth ship Node-only code paths (Buffer, fs).
 *   • We need Buffer.fill(0) to wipe document bytes deterministically
 *     on every exit path (Zero-Knowledge guarantee).
 */
export const runtime = 'nodejs';

/**
 * MUST stay equal to the value declared for this path in vercel.json.
 *
 * This used to read 300 while vercel.json asked for 800, and Vercel
 * does not document which of the two wins for an App Router handler —
 * so the real ceiling was unknowable by reading the code, which is the
 * part that actually matters here. Under the pessimistic reading the
 * function was being killed at 300s.
 *
 * That is not theoretical. A two-framework audit measured at 182s, and
 * pass 1 retries once with a doubled token budget when the model
 * truncates — which roughly doubles that. The kill lands after the
 * credit is consumed and before the audit row is written, so it leaves
 * exactly the trace we found on 10 Sep and could not explain: a credit
 * spent, no audit row, no error anywhere.
 *
 * 800 is the Fluid Compute ceiling and what vercel.json already
 * requests. Aligning removes the ambiguity rather than betting on a
 * precedence rule Vercel has not written down.
 */
export const maxDuration = 800;

/**
 * Cost protection. Tighter on IP than on org, and plan-aware: a paying
 * customer (Pro / Enterprise / Business) is on a 20-per-hour IP bucket
 * so a small compliance team behind a corporate NAT isn't artificially
 * throttled. Anonymous and Starter orgs stay at the original 5/h.
 */
const IP_LIMIT_FREE = { windowMs: 60 * 60 * 1000, max: 5  };  // 5/h per IP
const IP_LIMIT_PAID = { windowMs: 60 * 60 * 1000, max: 20 }; // 20/h per IP
const ORG_LIMIT     = { windowMs: 24 * 60 * 60 * 1000, max: 50 };  // 50/day per org

const PAID_PLANS = new Set(['pro', 'enterprise']);
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

// Validate against the real catalogue instead of casting. The previous
// `z.string().transform(s => s.split(',') as FrameworkId[])` was a blind
// cast: any string became a "valid" FrameworkId, and an id that matched
// nothing was then silently dropped by buildAuditSystemPrompt's
// `if (!f) continue`. Scope narrowed without anyone being told.
const FRAMEWORK_IDS = FRAMEWORKS.map((f) => f.id) as [FrameworkId, ...FrameworkId[]];

const Meta = z.object({
  organizationId: z.string().uuid(),
  frameworks: z.array(z.enum(FRAMEWORK_IDS)).min(1),
  targetLanguage: z.string().min(2).max(10)
});

/**
 * `<select multiple>` submits one form entry per selected option, and
 * FormData.get() returns only the FIRST of them — so every framework
 * after the first was discarded before it ever reached the engine. A
 * customer who selected GDPR + EU AI Act spent a credit and received a
 * GDPR-only audit, presented as complete. Reproduced on 10 Sep 2026.
 *
 * getAll() is the fix. The comma split is kept so a non-browser client
 * can still post `frameworks=gdpr,eu_ai_act` as one value.
 */
function readFrameworks(form: FormData): string[] {
  const ids = form
    .getAll('frameworks')
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  // Canonical order, no duplicates: the scope is a set, and it is part
  // of the audit dedup key (see audits_dedup_idx). Without this,
  // selecting the same two frameworks in a different order would look
  // like a different audit and re-run the whole pipeline.
  return [...new Set(ids)].sort();
}

/**
 * Strongly-typed error envelope so the client can either show the
 * technical code (failure card) or branch on it (e.g. 402 → pricing
 * redirect). Every code below corresponds to exactly one place in the
 * pipeline that can fail, so a stuck audit is impossible: we either
 * return success or we return one of these.
 */
type AuditError =
  | 'document_required'
  | 'document_too_large'
  | 'document_too_large_free_tier'
  | 'invalid_metadata'
  | 'rate_limited'
  | 'no_credits'
  | 'credit_check_failed'
  | 'extraction_failed'
  | 'anthropic_error'
  | 'openai_error'
  | 'multipass_failed'
  | 'supabase_write_failed'
  | 'findings_insert_failed'
  | 'unauthenticated'
  | 'organization_mismatch';

function errorJson(error: AuditError, detail: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, detail, ...extra }, { status });
}

/**
 * Classify a Multi-Pass exception so the customer sees what actually
 * failed. The Anthropic and OpenAI SDKs both produce typed error
 * subclasses but their constructor names are stable enough that
 * matching on the message + class name keeps the dependency graph
 * minimal.
 */
function classifyAiError(err: unknown): { code: AuditError; detail: string } {
  const detail = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.constructor.name : '';
  const lower = detail.toLowerCase();

  if (name.startsWith('Anthropic') || lower.includes('anthropic') || lower.includes('claude')) {
    return { code: 'anthropic_error', detail };
  }
  if (name.startsWith('OpenAI') || lower.includes('openai') || lower.includes('gpt')) {
    return { code: 'openai_error', detail };
  }
  return { code: 'multipass_failed', detail };
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const log = (step: string, extra: Record<string, unknown> = {}) =>
    console.log('[audit]', JSON.stringify({ step, t: Date.now() - t0, ...extra }));

  // ---- 1. Parse + validate input ------------------------------------
  const form = await request.formData();
  const file = form.get('document');
  if (!(file instanceof Blob)) {
    return errorJson('document_required', 'No file in `document` form field.', 400);
  }
  if (file.size > 25 * 1024 * 1024) {
    return errorJson('document_too_large', `File is ${file.size} bytes, max 25 MB.`, 413);
  }

  let meta: z.infer<typeof Meta>;
  try {
    meta = Meta.parse({
      organizationId: form.get('organizationId'),
      frameworks: readFrameworks(form),
      targetLanguage: form.get('targetLanguage')
    });
  } catch (err) {
    return errorJson('invalid_metadata', err instanceof Error ? err.message : String(err), 400);
  }

  // ---- 1b. Org spoof guard ------------------------------------------
  // The anonymous-org UUID is the public-share-link placeholder and
  // intentionally needs no auth — anyone can submit a one-shot audit
  // against it without an account. For every other UUID we require
  // an authenticated session whose org id matches what the client
  // claims, otherwise a logged-in user from org A could spend org B's
  // audit credits, pollute B's audit history with arbitrary
  // documents, or trip B's per-org rate limit (50/day) as a DoS.
  const isAnonymousOrg = meta.organizationId === '00000000-0000-0000-0000-000000000000';
  if (!isAnonymousOrg) {
    const user = await getCurrentUser();
    if (!user) {
      return errorJson('unauthenticated', 'Sign in required for org-scoped audits.', 401);
    }
    const sessionOrgId = organizationIdFromUser(user);
    if (sessionOrgId !== meta.organizationId) {
      log('org_mismatch_rejected', { claimed: meta.organizationId, session: sessionOrgId });
      return errorJson('organization_mismatch', 'Claimed organization does not match session.', 403);
    }
  }
  log('input_parsed', { fileSize: file.size, frameworks: meta.frameworks, lang: meta.targetLanguage });

  // ---- 1c. Analytics — submission funnel step -----------------------
  // We fire `audit_submitted` on every submission and additionally
  // `first_audit_submitted` on the org's first audit ever. The
  // first-time check is a 1-row LIMIT 1 lookup (no count, no scan)
  // so it adds <5ms to the request — cheap insurance to keep the
  // funnel step distinct in PostHog dashboards. The single-row
  // probe runs only for non-anonymous orgs; anonymous-org
  // submissions are public share-link runs and don't have a
  // stable identity to attribute "first" to.
  let isFirstAudit = false;
  if (!isAnonymousOrg) {
    const probe = await supabaseService()
      .from('audits')
      .select('id', { head: true, count: 'exact' })
      .eq('organization_id', meta.organizationId)
      .limit(1);
    isFirstAudit = (probe.count ?? 0) === 0;
  }
  await captureServerEvent({
    distinctId: meta.organizationId,
    event: 'audit_submitted',
    properties: {
      file_size: file.size,
      frameworks: meta.frameworks,
      target_language: meta.targetLanguage,
      is_anonymous_org: isAnonymousOrg,
      is_first_audit: isFirstAudit
    }
  });
  if (isFirstAudit) {
    await captureServerEvent({
      distinctId: meta.organizationId,
      event: 'first_audit_submitted',
      properties: {
        frameworks: meta.frameworks,
        target_language: meta.targetLanguage,
        file_size: file.size
      }
    });
  }

  // ---- 2. Rate limit ------------------------------------------------
  // Plan-aware IP bucket: lookup the org's active subscription once,
  // bump the ceiling for paying customers. Read uses the service
  // client so it bypasses RLS — we own the row.
  const ip = clientIpFrom(request.headers);
  const { data: subRow } = await supabaseService()
    .from('subscriptions')
    .select('plan,status')
    .eq('organization_id', meta.organizationId)
    .maybeSingle();
  const isPaid = !!subRow
    && PAID_PLANS.has((subRow as { plan?: string }).plan ?? '')
    && PAID_STATUSES.has((subRow as { status?: string }).status ?? '');
  const ipLimitConfig = isPaid ? IP_LIMIT_PAID : IP_LIMIT_FREE;
  const ipLimit  = rateLimit({ key: `audit:ip:${ip}`,                ...ipLimitConfig });
  const orgLimit = rateLimit({ key: `audit:org:${meta.organizationId}`, ...ORG_LIMIT });
  if (!ipLimit.ok || !orgLimit.ok) {
    const offender = !ipLimit.ok ? ipLimit : orgLimit;
    return NextResponse.json(
      { error: 'rate_limited', detail: 'Too many requests', resetAt: offender.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((offender.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Reset': String(Math.floor(offender.resetAt / 1000))
        }
      }
    );
  }

  const db = supabaseService();

  // ---- 3. Credit gate + free-trial fallback (atomic) ----------------
  // Order of precedence:
  //   1. Anonymous-org and paid customers go straight through the
  //      credit-consume RPC (anonymous bypasses inside the function).
  //   2. If the consume returns false (no credits) AND the caller is a
  //      real org currently on the FREE tier AND they have not yet
  //      used their one freebie, we authorise the audit as a free
  //      trial. The free trial is gated on file size (2 MB cap) to
  //      keep AI costs predictable.
  //   3. Any other case → 402, redirect to /pricing.
  const { data: consumed, error: creditErr } = await db.rpc('try_consume_audit_credit', {
    p_org_id: meta.organizationId
  });
  if (creditErr) {
    log('credit_check_failed', { error: creditErr.message });
    return errorJson('credit_check_failed', creditErr.message, 500);
  }

  let usingFreeTrial = false;
  if (!consumed) {
    if (isAnonymousOrg) {
      // Should not happen — the SQL function returns true for anon.
      // Guard rail in case the function definition changes.
      log('no_credits_anon_unexpected');
      return NextResponse.json(
        { error: 'no_credits', detail: 'Anonymous quota exceeded.', redirect: '/pricing' },
        { status: 402 }
      );
    }
    const tier = await getTierForOrg(db, meta.organizationId);
    const { data: orgRow } = await db
      .from('organizations')
      .select('free_audit_used')
      .eq('id', meta.organizationId)
      .maybeSingle();
    const freeAuditUsed =
      (orgRow as { free_audit_used?: boolean } | null)?.free_audit_used ?? false;

    if (tier === 'free' && !freeAuditUsed) {
      if (file.size > FREE_TIER_MAX_BYTES) {
        log('free_tier_size_rejected', { size: file.size, cap: FREE_TIER_MAX_BYTES });
        return errorJson(
          'document_too_large_free_tier',
          `Free tier max ${FREE_TIER_MAX_BYTES} bytes.`,
          413
        );
      }
      usingFreeTrial = true;
      log('free_trial_authorized');
    } else {
      log('no_credits', { tier, freeAuditUsed });
      return NextResponse.json(
        { error: 'no_credits', detail: 'Out of audit credits.', redirect: '/pricing' },
        { status: 402 }
      );
    }
  } else {
    log('credit_consumed');
  }

  // Helper: any failure path beyond this point must refund the credit.
  // Centralising this guarantees we never leak a paid credit when the
  // audit didn't actually deliver. Free-trial paths skip refunds —
  // there is nothing to refund (no credit was consumed) and we have
  // not yet flipped free_audit_used (that happens on success).
  const refundIfNeeded = async (reason: string) => {
    if (usingFreeTrial) {
      log('refund_skipped_free_trial', { reason });
      return;
    }
    const { error: refundErr } = await db.rpc('refund_audit_credit', {
      p_org_id: meta.organizationId
    });
    if (refundErr) {
      log('refund_failed', { reason, error: refundErr.message });
    } else {
      log('credit_refunded', { reason });
    }
  };


  // ---- 4. Extraction ------------------------------------------------
  // Runs before we answer, because the document hash is part of the
  // audit's identity and we cannot open its row without one. It is the
  // only genuinely fast stage of the pipeline (parsing bytes, no
  // network), so it costs the caller a moment, not a wait.
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file instanceof File ? file.name : undefined;
  const mime = file.type || undefined;

  let extracted;
  try {
    extracted = await extractText(buffer, { filename, mime });
    log('extracted', {
      type: extracted.type,
      charCount: extracted.charCount,
      redactionCount: extracted.redactionCount
    });
  } catch (err) {
    wipeBuffer(buffer);
    await refundIfNeeded('extraction_failed');
    return errorJson('extraction_failed', err instanceof Error ? err.message : String(err), 422);
  }

  const documentHash = hashDocument(extracted.text);

  // ---- 5. Replay an identical report before paying for it again -----
  // This check used to run only after the audit had been produced, so
  // an exact repeat cost a full pipeline — roughly $0.20 and three
  // minutes — before we discovered we already had the answer. Opening
  // the row up front means we can ask the question first.
  //
  // The scope is matched in JS rather than through PostgREST array
  // equality, for the same reason the pivot cache does: getting that
  // comparison wrong fails silently, and a dedup check that silently
  // never matches is indistinguishable from not having one.
  const { data: priorRows } = await db
    .from('audits')
    .select('id, risk_score, frameworks')
    .eq('organization_id', meta.organizationId)
    .eq('document_hash', documentHash)
    .eq('language', meta.targetLanguage)
    .eq('status', 'completed');

  const wantedScope = [...meta.frameworks].sort().join(',');
  const prior = (priorRows as { id: string; risk_score: number; frameworks: string[] }[] | null)
    ?.find((r) => [...(r.frameworks ?? [])].sort().join(',') === wantedScope);

  if (prior) {
    wipeBuffer(buffer);
    await refundIfNeeded('idempotent_replay');
    log('idempotent_replay', { auditId: prior.id });
    const { count } = await db
      .from('audit_findings')
      .select('*', { count: 'exact', head: true })
      .eq('audit_id', prior.id);
    return NextResponse.json({
      ok: true,
      auditId: prior.id,
      status: 'completed',
      riskScore: prior.risk_score,
      findingsCount: count ?? 0,
      redirect: `/dashboard/${prior.id}`,
      replay: true
    });
  }

  // ---- 6. Envelope-encrypt the document (opt-in retention) ----------
  // Done before the row is opened so the ciphertext lands in the same
  // INSERT. On any crypto failure we proceed without retention —
  // Zero-Knowledge fallback is strictly safer than a half-encrypted row.
  const { data: retentionRow } = await db
    .from('organizations')
    .select('retain_documents')
    .eq('id', meta.organizationId)
    .maybeSingle();
  const retain = (retentionRow as { retain_documents?: boolean } | null)?.retain_documents ?? false;

  // Buffers are encoded as Postgres bytea hex literals (\\x…). The
  // supabase-js JSON serializer doesn't natively know about Buffer,
  // so doing the encoding ourselves is both explicit and portable.
  const toBytea = (b: Buffer) => `\\x${b.toString('hex')}`;
  let cryptoFields: {
    document_ciphertext: string;
    document_iv: string;
    document_auth_tag: string;
    document_encrypted_at: string;
  } | null = null;
  if (retain) {
    try {
      const enc = encryptDocument(extracted.text);
      cryptoFields = {
        document_ciphertext: toBytea(enc.ciphertext),
        document_iv: toBytea(enc.iv),
        document_auth_tag: toBytea(enc.authTag),
        document_encrypted_at: new Date().toISOString()
      };
      log('document_encrypted', { bytes: enc.ciphertext.length });
    } catch (err) {
      log('encryption_skipped', { reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // The raw bytes have now been parsed and, if retained, encrypted.
  // Nothing downstream reads them again.
  wipeBuffer(buffer);

  // ---- 7. Open the audit row ----------------------------------------
  // `language` here is the language the customer ASKED for. Pass 2 can
  // degrade to English, and the closing update records what was
  // actually DELIVERED — see finishAudit.
  //
  // This insert cannot hit the dedup index: since migration 0016 that
  // index covers completed rows only, precisely so an attempt never
  // occupies the slot of a report.
  const { data: opened, error: openErr } = await db
    .from('audits')
    .insert({
      organization_id: meta.organizationId,
      document_hash: documentHash,
      frameworks: meta.frameworks,
      status: 'running',
      language: meta.targetLanguage,
      // Whether this audit cost a credit is knowable only here.
      // Recording it is what lets the reaper and the polling endpoint
      // refund an abandoned audit without handing free credits to
      // free-trial runs that never spent one.
      credit_consumed: !usingFreeTrial,
      ...(cryptoFields ?? {})
    })
    .select('id')
    .single();

  if (openErr || !opened) {
    log('supabase_write_failed', { code: openErr?.code, message: openErr?.message });
    alertOps('audit.open_failed', {
      error: openErr?.message ?? 'insert returned no id',
      frameworks: meta.frameworks
    });
    await refundIfNeeded('supabase_write_failed');
    return errorJson(
      'supabase_write_failed',
      openErr?.message ?? 'audit row insert returned no id',
      500
    );
  }

  const auditId = (opened as { id: string }).id;
  log('audit_opened', { auditId });

  await logAccess({
    organizationId: meta.organizationId,
    action: 'audit_created',
    auditId,
    ip,
    userAgent: request.headers.get('user-agent')
  });

  // ---- 8. Hand the slow work to the platform ------------------------
  // Everything above answers in a second or two. Everything below takes
  // minutes, and used to be held open on the customer's connection —
  // which meant a closed tab, a sleeping phone or a carrier proxy
  // timing out destroyed an audit they had already paid for. The whole
  // NDJSON stream and its ten-second whitespace heartbeat existed only
  // to survive that; with the work off the request there is nothing
  // left to keep alive.
  //
  // waitUntil keeps the invocation running after the response is sent.
  // It does NOT extend maxDuration — the ceiling is still 800s — so the
  // row can still be abandoned by an eviction or a deploy. That is what
  // the polling endpoint's self-heal (15 min) and the reaper (20 min)
  // are for, and both refund.
  waitUntil(
    runAuditPipeline({
      auditId,
      documentText: extracted.text,
      documentHash,
      organizationId: meta.organizationId,
      frameworks: meta.frameworks,
      targetLanguage: meta.targetLanguage,
      usingFreeTrial,
      startedAt: t0
    })
  );

  return NextResponse.json(
    {
      ok: true,
      auditId,
      status: 'running',
      poll: `/api/audit/${auditId}`,
      redirect: `/dashboard/${auditId}`
    },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );
}

/* ------------------------------------------------------------------ */
/* Background pipeline                                                */
/* ------------------------------------------------------------------ */

interface PipelineInput {
  auditId: string;
  documentText: string;
  documentHash: string;
  organizationId: string;
  frameworks: FrameworkId[];
  targetLanguage: string;
  usingFreeTrial: boolean;
  startedAt: number;
}

/**
 * Everything that takes minutes, run after the response has been sent.
 *
 * Contract: this function must ALWAYS leave the audit row in a terminal
 * status. It is the only thing standing between a customer and a
 * spinner that never stops — and unlike the request path, there is
 * nobody on the other end to show an error to, so every failure has to
 * be written down rather than returned.
 */
async function runAuditPipeline(input: PipelineInput): Promise<void> {
  const db = supabaseService();
  const log = (step: string, extra: Record<string, unknown> = {}) =>
    console.log(
      '[audit]',
      JSON.stringify({ step, t: Date.now() - input.startedAt, auditId: input.auditId, ...extra })
    );

  const refund = async (reason: string) => {
    if (input.usingFreeTrial) {
      log('refund_skipped_free_trial', { reason });
      return;
    }
    const { error } = await db.rpc('refund_audit_credit', { p_org_id: input.organizationId });
    if (error) log('refund_failed', { reason, error: error.message });
    else log('credit_refunded', { reason });
  };

  const fail = async (code: string, detail: string) => {
    const { error } = await db
      .from('audits')
      .update({ status: 'failed', error_message: `${code}: ${detail}` })
      // Never overwrite a row something else already resolved — the
      // polling endpoint's self-heal and the reaper both write here.
      .eq('id', input.auditId)
      .in('status', ['pending', 'running']);
    if (error) {
      // Now the row really can hang: we failed to record the failure.
      // The reaper is the last line, and it only sweeps rows still in a
      // non-terminal status — which this one is.
      log('fail_write_failed', { code, error: error.message });
      alertOps('audit.fail_write_failed', { auditId: input.auditId, code, error: error.message });
    }
    await refund(code);
  };

  // ---- AI analysis -------------------------------------------------
  let report;
  try {
    log('multipass_start');
    // The pivot cache makes a second language nearly free: pass 1 is
    // language-independent, so only the translation is billed. Keyed on
    // the org too — two customers can upload the same public document,
    // and neither may read findings produced from the other's upload.
    const pivotKey = {
      organization_id: input.organizationId,
      document_hash: input.documentHash,
      frameworks: input.frameworks
    };
    report = await runMultiPassAudit(
      {
        documentText: input.documentText,
        frameworks: input.frameworks,
        targetLanguage: input.targetLanguage
      },
      {
        read: async () => {
          // Matched in JS rather than with .eq() on the array column:
          // PostgREST array equality is a shape we do not control, and
          // getting it wrong here fails silently — the cache would
          // simply never hit, and we would go on paying for pass 1
          // twice while believing we had fixed it.
          const { data } = await db
            .from('audit_pass1_cache')
            .select('pivot, frameworks')
            .eq('organization_id', pivotKey.organization_id)
            .eq('document_hash', pivotKey.document_hash);

          const wanted = [...pivotKey.frameworks].sort().join(',');
          const row = (data as { pivot?: unknown; frameworks?: string[] }[] | null)?.find(
            (r) => [...(r.frameworks ?? [])].sort().join(',') === wanted
          );
          const hit = row?.pivot ?? null;
          if (hit) log('pivot_cache_hit', { documentHash: pivotKey.document_hash });
          return hit;
        },
        write: async (pivot) => {
          await db
            .from('audit_pass1_cache')
            .upsert(
              { ...pivotKey, pivot },
              { onConflict: 'organization_id,document_hash,frameworks' }
            );
        }
      }
    );
    log('multipass_done', { findings: report.findings.length, riskScore: report.riskScore });
  } catch (err) {
    const { code, detail } = classifyAiError(err);
    log('multipass_failed', { code, detail });
    // The credit is refunded and the customer sees a clean failure, so
    // nothing escalates on its own — but this is the product failing to
    // deliver. An expired or missing provider key shows up here and
    // nowhere else.
    alertOps('audit.multipass_failed', {
      auditId: input.auditId,
      code,
      detail,
      frameworks: input.frameworks,
      targetLanguage: input.targetLanguage
    });
    await fail(code, detail);
    return;
  }

  // ---- Findings ----------------------------------------------------
  // Written BEFORE the row is marked completed. The row's status is
  // what the report page trusts, so a 'completed' row whose findings
  // never landed renders as "no findings, your document is compliant"
  // next to a risk score of 78 — not a degraded report, a false one,
  // and in a compliance product the most damaging thing we can ship.
  if (report.findings.length > 0) {
    const { error: findingsErr } = await db.from('audit_findings').insert(
      report.findings.map((f) => ({
        audit_id: input.auditId,
        framework_id: f.framework,
        citation: f.citation,
        severity: f.severity,
        title: f.title,
        body: f.body,
        recommendation: f.recommendation,
        evidence: f.evidence
      }))
    );
    if (findingsErr) {
      log('findings_insert_failed', { error: findingsErr.message });
      alertOps('audit.findings_insert_failed', {
        auditId: input.auditId,
        error: findingsErr.message,
        frameworks: input.frameworks,
        expectedFindings: report.findings.length
      });
      await fail('findings_insert_failed', findingsErr.message);
      return;
    }
    log('findings_persisted', { count: report.findings.length });
  }

  // ---- Close the row -----------------------------------------------
  // `language` becomes the language actually DELIVERED, which is not
  // always the one requested: pass 2 degrades to English rather than
  // publish a half-translated compliance report.
  const { error: closeErr } = await db
    .from('audits')
    .update({
      status: 'completed',
      risk_score: report.riskScore,
      summary: report.summary,
      language: report.language,
      completed_at: report.generatedAt,
      error_message: null
    })
    .eq('id', input.auditId)
    .in('status', ['pending', 'running']);

  if (closeErr) {
    // 23505 against audits_dedup_idx means an identical report was
    // delivered while this one was running. The commonest way is a
    // degradation: the customer asked for Arabic, pass 2 failed, and
    // the English report they already had is the same report. We are
    // not going to store it twice, and we are not going to charge for
    // rediscovering it.
    if (closeErr.code === '23505') {
      const { data: twins } = await db
        .from('audits')
        .select('id, frameworks')
        .eq('organization_id', input.organizationId)
        .eq('document_hash', input.documentHash)
        .eq('language', report.language)
        .eq('status', 'completed');
      const wanted = [...input.frameworks].sort().join(',');
      const twin = (twins as { id: string; frameworks: string[] }[] | null)?.find(
        (t) => [...(t.frameworks ?? [])].sort().join(',') === wanted
      );

      log('duplicate_on_close', { deliveredLanguage: report.language, twinId: twin?.id });
      // Clean up the findings we just wrote for a row nobody will read.
      await db.from('audit_findings').delete().eq('audit_id', input.auditId);
      await fail(
        'duplicate_report',
        twin ? `an identical report already exists: ${twin.id}` : 'an identical report already exists'
      );
      return;
    }

    log('close_failed', { error: closeErr.message });
    alertOps('audit.close_failed', { auditId: input.auditId, error: closeErr.message });
    await fail('supabase_write_failed', closeErr.message);
    return;
  }

  // ---- Bookkeeping -------------------------------------------------
  // Free-trial flag flips only now that a report exists. Failure to
  // flip is logged but not fatal — worst case the customer gets a
  // second freebie, and we would rather over-serve than fail closed.
  if (input.usingFreeTrial) {
    const { error: flagErr } = await db
      .from('organizations')
      .update({ free_audit_used: true })
      .eq('id', input.organizationId);
    if (flagErr) log('free_audit_flag_failed', { error: flagErr.message });
    else log('free_audit_consumed');
  }

  await captureServerEvent({
    distinctId: input.organizationId,
    event: 'audit_completed',
    properties: {
      audit_id: input.auditId,
      risk_score: report.riskScore,
      findings_count: report.findings.length,
      frameworks: input.frameworks,
      target_language: input.targetLanguage,
      delivered_language: report.language,
      using_free_trial: input.usingFreeTrial
    }
  });

  log('done', { riskScore: report.riskScore, findings: report.findings.length });
}
