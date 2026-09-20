import { Check, ExternalLink, FileSearch, HelpCircle, Lock, Minus, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DomainVerifyButton } from '@/components/DomainVerifyButton';
import { verificationRecordName, verificationToken } from '@/lib/domain-verification';
import { classifyScanFailure } from '@/lib/scan-failure';
import { supabaseService } from '@/lib/supabase';

/**
 * The public half of the scan: facts about a document, never a verdict
 * about whoever published it.
 *
 * This is the page a DPO sends to a colleague, so it is also the page that
 * earns the links this site does not have. Everything on it is designed to
 * survive being opened by the company it names.
 *
 * NOINDEX UNTIL THE DOMAIN IS PROVED.
 *
 * Anyone can run a scan and share the link — that is the virality worth
 * having, and it costs the scanned company nothing, because a link is not
 * a search result. Google is only invited in once somebody has proved,
 * with a DNS TXT record, that they control the domain: their document,
 * their domain, their choice. A company that wrote a privacy notice for its
 * own visitors did not ask to be catalogued under its own name.
 *
 * NO SCORE, AND NO TOTAL.
 *
 * A number out of ten would be a judgement wearing a fact's clothes, and
 * the reader would quote the number and drop the seven sentences that made
 * it. There are seven observations and each one stands alone with its
 * evidence.
 */

export const dynamic = 'force-dynamic';

/** One sentence per failure code. See lib/scan-failure.ts for the line
 *  none of them cross: every one is about our connection attempt, never
 *  about the company. */
const FAILURE_KEY = {
  refused_connection: 'failureRefusedConnection',
  unreachable: 'failureUnreachable',
  tls: 'failureTls',
  robots: 'failureRobots',
  no_link: 'failureNoLink',
  shell_page: 'failureShellPage',
  pdf: 'failurePdf',
  http_error: 'failureHttpError',
  other: 'failureOther'
} as const;

interface PageProps {
  params: { locale: string; token: string };
}

/** Shape of the row set this page renders. */
interface ScanRow {
  id: string;
  domain: string;
  status: string;
  failure: string | null;
  created_at: string;
}

/**
 * Has anyone proved they control this domain?
 *
 * Asked of the domain, not of the scan. Proving you administer example.com
 * is a fact about example.com, and 0035's per-scan column would have had to
 * be copied onto every future row or silently not apply to it.
 */
async function isDomainVerified(domain: string): Promise<boolean> {
  const { data } = await supabaseService()
    .from('domain_verifications')
    .select('domain')
    .eq('domain', domain)
    .maybeSingle();
  return Boolean(data);
}

async function loadScan(token: string): Promise<ScanRow | null> {
  // Shape-checked before the query: the token comes from a URL segment.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;

  const { data } = await supabaseService()
    .from('scans')
    .select('id, domain, status, failure, created_at')
    .eq('token', token)
    .maybeSingle();

  return (data as ScanRow | null) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const scan = await loadScan(params.token);
  if (!scan) return { robots: { index: false, follow: false } };

  const t = await getTranslations({ locale: params.locale, namespace: 'scan' });
  const verified = await isDomainVerified(scan.domain);

  return {
    title: t('metaTitle', { domain: scan.domain }),
    description: t('metaDescription', { domain: scan.domain }),
    // The whole policy in one line. Unverified means shareable, not
    // searchable.
    robots: { index: verified, follow: verified },
    // A running scan reloads itself. A meta refresh rather than a client
    // component, so it works with scripting disabled and inside whatever
    // in-app browser the link was opened in.
    ...(scan.status === 'running' || scan.status === 'queued'
      ? { other: { refresh: '6' } }
      : {})
  };
}

export default async function ScanPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('scan');

  const scan = await loadScan(params.token);
  if (!scan) notFound();

  const db = supabaseService();
  const { data: snapshot } = await db
    .from('scan_snapshots')
    .select('id, url, provenance, content_hash, fetched_at')
    .eq('scan_id', scan.id)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: observations } = snapshot
    ? await db
        .from('scan_observations')
        .select('observation, finding, evidence')
        .eq('snapshot_id', snapshot.id)
    : { data: null };

  const running = scan.status === 'running' || scan.status === 'queued';
  const verified = await isDomainVerified(scan.domain);
  const txtValue = verificationToken(scan.domain);

  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{scan.domain}</Badge>
          {verified ? (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {t('verifiedBadge')}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden />
              {t('notIndexed')}
            </Badge>
          )}
        </div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
          {t('headline')}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('lead', { domain: scan.domain })}
        </p>
      </header>

      {running && (
        <Card>
          <CardContent className="grid gap-2 py-6">
            <p className="text-sm font-medium">{t('statusRunning')}</p>
            <p className="text-sm text-muted-foreground">{t('statusRunningHint')}</p>
          </CardContent>
        </Card>
      )}

      {scan.status === 'failed' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('statusFailedTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {/* The sentence first, the machine's string underneath.
                `read ECONNRESET` is exact and means nothing to a data
                protection officer — and it was being printed in English on
                a French page, on the one line a visitor most needs to
                understand. The raw code stays because it is the evidence:
                a reader who knows what it means can check that we read it
                correctly, exactly as an observation carries its quotation. */}
            <p className="text-sm leading-relaxed">
              {t(FAILURE_KEY[classifyScanFailure(scan.failure)])}
            </p>
            {scan.failure && (
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('failureTechnical')}
                </span>
                <code className="rounded-md border bg-muted/50 p-3 font-mono text-xs">
                  {scan.failure}
                </code>
              </div>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">{t('statusFailedLead')}</p>
          </CardContent>
        </Card>
      )}

      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('sourceHeading')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <a
              href={snapshot.url}
              className="inline-flex items-start gap-1.5 break-all font-medium hover:underline"
              // The destination is a third party's page; nothing about our
              // session travels with the visitor.
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              {snapshot.url}
              <ExternalLink className="mt-1 h-3 w-3 shrink-0" aria-hidden />
            </a>

            <div className="flex flex-wrap gap-2">
              {/* How we found it, on the page. A document the site linked
                  to is the site's own answer to "where is your privacy
                  policy"; a conventional path is our guess, and a reader is
                  entitled to know which one they are reading about. */}
              <Badge variant="secondary">
                {snapshot.provenance === 'linked-from-homepage'
                  ? t('provenanceLinked')
                  : snapshot.provenance === 'listed-in-sitemap'
                    ? t('provenanceSitemap')
                    : t('provenanceGuessed')}
              </Badge>
              <Badge variant="outline">
                {t('fetchedAt', {
                  date: new Date(snapshot.fetched_at).toISOString().slice(0, 16).replace('T', ' ')
                })}
              </Badge>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('hashLabel')}
              </div>
              <code className="break-all text-xs text-muted-foreground">
                {snapshot.content_hash}
              </code>
              {/* The sentence that makes everything below checkable by
                  somebody who does not trust us. */}
              <p className="text-xs leading-relaxed text-muted-foreground">{t('hashHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {observations && observations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('findingsHeading')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {observations.map((o) => (
              <div key={o.observation} className="grid gap-1.5 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-start gap-2">
                  <FindingIcon finding={o.finding} />
                  <span className="text-sm font-medium">
                    {t(`observation.${toKey(o.observation)}` as 'observation.retentionPeriodStated')}
                  </span>
                </div>
                <span className="ps-6 text-xs text-muted-foreground">
                  {o.finding === 'present'
                    ? t('findingPresent')
                    : o.finding === 'unclear'
                      ? t('findingUnclear')
                      : t('findingNotFound')}
                </span>
                {o.evidence && (
                  <blockquote className="ms-6 border-s-2 ps-3 text-xs leading-relaxed text-muted-foreground">
                    <span className="mb-1 block font-semibold uppercase tracking-wider">
                      {t('evidenceLabel')}
                    </span>
                    {o.evidence}
                  </blockquote>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/*
        The boundary, and it is not a disclaimer in small print.

        It states what the page is and what it is not, at full size, next to
        the findings. "This document does not state a retention period" is
        an observable property of a text; "this company is non-compliant" is
        a legal qualification and defamatory if wrong. The page never makes
        the second kind of statement, and says so rather than leaving a
        reader to infer it.
      */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm">{t('boundaryHeading')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('boundaryBody', { domain: scan.domain })}
          </p>
        </CardContent>
      </Card>

      {/*
        Indexing is the one consequence here that reaches outside this page,
        so it is the one thing gated on proof rather than on asking. Offered
        only when there is something to index.
      */}
      {!verified && scan.status === 'done' && txtValue && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('verifyHeading')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('verifyLead', { domain: scan.domain })}
            </p>

            <div className="grid gap-2">
              <p className="text-sm">{t('verifyStep1')}</p>
              <dl className="grid gap-2 rounded-md border bg-muted/50 p-3 text-xs">
                <div className="grid gap-0.5">
                  <dt className="font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('verifyNameLabel')}
                  </dt>
                  <dd className="break-all font-mono">{verificationRecordName(scan.domain)}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('verifyValueLabel')}
                  </dt>
                  <dd className="break-all font-mono">{txtValue}</dd>
                </div>
              </dl>
              {/* Why a subdomain and not the apex: their root TXT holds SPF
                  and DMARC, and asking somebody to edit that record for our
                  indexing would be asking them to risk their email. */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('verifyWhySubdomain')}
              </p>
            </div>

            <p className="text-sm text-muted-foreground">{t('verifyStep2')}</p>

            <DomainVerifyButton
              token={params.token}
              labels={{
                cta: t('verifyCta'),
                checking: t('verifyChecking'),
                done: t('verifyDone'),
                failed: t('verifyFailed'),
                notConfigured: t('verifyNotConfigured')
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ctaTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{t('ctaBody')}</p>
          <Button asChild className="justify-self-start">
            <Link href="/audit">{t('ctaButton')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FindingIcon({ finding }: { finding: string }) {
  if (finding === 'present') {
    return <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
  }
  if (finding === 'unclear') {
    return <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />;
  }
  // Deliberately neutral. A red cross would read as a failure, and "we
  // looked and did not find it" is not a failure of the document — it may
  // be behind a script, on a sub-page, or written in words we did not
  // recognise.
  return <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/** snake_case in the database, camelCase in the message files. */
function toKey(observation: string): string {
  return observation.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
