import { NextResponse } from 'next/server';
import { logAccess } from '@/lib/access-log';
import { fromBytea, toBytea } from '@/lib/bytea';
import { decryptDocument, encryptDocument, needsRewrap } from '@/lib/document-crypto';
import { clientIpFrom } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase';
import { getCurrentUser, organizationIdFromUser } from '@/lib/supabase-server';

/**
 * Decrypt and return the retained document for an audit.
 *
 * Auth: anonymous-org audits are public-by-UUID share-links and
 * intentionally never retain bytes (migration 0009 forces
 * organizations.retain_documents = false for that placeholder), so
 * they'll always return 404 here. Everything else requires the
 * caller's organization to match the audit's organization.
 *
 * Response shape mirrors the editor's expectations:
 *   200 → { text: string }
 *   404 → { error: 'no_retained_document' } when the audit row has no
 *         ciphertext (legacy audits, or org opted out of retention).
 *   401/404 on auth / lookup failures.
 *
 * The decrypted text is held in memory for the duration of the
 * response only. It's never logged.
 */
export const runtime = 'nodejs';

const ANONYMOUS_ORG_ID = '00000000-0000-0000-0000-000000000000';

interface AuditCryptoRow {
  id: string;
  organization_id: string;
  document_ciphertext: string | null;   // bytea returned by PostgREST as '\\xHEX'
  document_iv: string | null;
  document_auth_tag: string | null;
  /** Null on rows written before the keyring; the reader treats it as v1. */
  document_key_id: string | null;
}



export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const db = supabaseService();

  const { data: auditRaw, error } = await db
    .from('audits')
    .select('id,organization_id,document_ciphertext,document_iv,document_auth_tag,document_key_id')
    .eq('id', params.id)
    .maybeSingle();

  if (error || !auditRaw) {
    return NextResponse.json({ error: 'audit_not_found' }, { status: 404 });
  }
  const audit = auditRaw as AuditCryptoRow;

  if (audit.organization_id === ANONYMOUS_ORG_ID) {
    return NextResponse.json({ error: 'no_retained_document' }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user || organizationIdFromUser(user) !== audit.organization_id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!audit.document_ciphertext || !audit.document_iv || !audit.document_auth_tag) {
    return NextResponse.json({ error: 'no_retained_document' }, { status: 404 });
  }

  let plaintext: string;
  try {
    plaintext = decryptDocument({
      ciphertext: fromBytea(audit.document_ciphertext),
      iv: fromBytea(audit.document_iv),
      authTag: fromBytea(audit.document_auth_tag),
      // Null on every row written before the keyring existed; the
      // reader resolves that to v1, the pre-keyring key.
      keyId: audit.document_key_id
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'decrypt_failed', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    );
  }

  // Lazy rotation.
  //
  // This document is open in memory and we know it is sealed under a
  // key that is no longer the active one, so re-sealing it costs one
  // encrypt and one UPDATE. Doing it here rather than in a migration
  // is what makes a retired key actually retirable: a keyring that can
  // never shed a key has not rotated, it has only grown.
  //
  // Guarded on the ciphertext we read, so a concurrent re-wrap or a
  // deletion between the read and this write leaves the row alone
  // rather than overwriting someone else's work. Failures are logged
  // and swallowed — the customer asked for their document, and a
  // maintenance write must never be the reason they do not get it.
  if (needsRewrap(audit.document_key_id)) {
    try {
      const resealed = encryptDocument(plaintext);
      const { error: rewrapErr } = await db
        .from('audits')
        .update({
          document_ciphertext: toBytea(resealed.ciphertext),
          document_iv: toBytea(resealed.iv),
          document_auth_tag: toBytea(resealed.authTag),
          document_key_id: resealed.keyId
        })
        .eq('id', audit.id)
        .eq('document_ciphertext', audit.document_ciphertext);
      if (rewrapErr) {
        console.warn('[audit/document] rewrap_failed', {
          auditId: audit.id,
          error: rewrapErr.message
        });
      } else {
        console.log('[audit/document] rewrapped', {
          auditId: audit.id,
          from: audit.document_key_id ?? 'v1',
          to: resealed.keyId
        });
      }
    } catch (err) {
      console.warn('[audit/document] rewrap_skipped', {
        auditId: audit.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // Trust ledger: every plaintext access is visible to the customer
  // in /dashboard/security. Logging is best-effort and does not gate
  // the response — a logging outage must not deny the user their data.
  await logAccess({
    organizationId: audit.organization_id,
    action: 'document_decrypted',
    userId: user.id,
    auditId: audit.id,
    ip: clientIpFrom(request.headers),
    userAgent: request.headers.get('user-agent')
  });

  return NextResponse.json(
    { text: plaintext },
    {
      headers: {
        // Decrypted plaintext must never sit in a CDN or browser cache.
        'cache-control': 'no-store, no-cache, must-revalidate',
        pragma: 'no-cache'
      }
    }
  );
}
