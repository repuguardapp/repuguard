import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CronRunButton } from '@/components/CronRunButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { supabaseService } from '@/lib/supabase';
import { getCurrentAdminUser } from '@/lib/supabase-server';

/**
 * Operator console for the legal-watch pipeline.
 *
 * Exists because the alternative was pasting CRON_SECRET into a URL
 * bar, and that turned out to be impossible as well as unwise: the
 * secret is stored Sensitive in Vercel, so the person who set it cannot
 * read it back. A job you cannot run on demand is a job you cannot
 * debug, and four feed URLs went to production unverified because of it.
 *
 * The source table above the buttons is the point. `last_status` and
 * `last_error` are written by the poller on every run, so a feed that
 * has moved says so here in one line instead of being inferred from an
 * absence of rows — the failure mode this codebase keeps relearning.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ops',
  robots: { index: false, follow: false }
};

interface SourceRow {
  id: string;
  name: string;
  jurisdiction: string;
  feed_url: string;
  enabled: boolean;
  last_polled_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

const JOBS = [
  { path: '/api/cron/watch-legal', label: 'Run watch now' },
  { path: '/api/cron/extract-legal', label: 'Run extraction now' },
  { path: '/api/cron/localize-legal', label: 'Run localisation now' }
];

export default async function OpsPage({ params }: { params: { locale: string } }) {
  unstable_setRequestLocale(params.locale);

  const user = await getCurrentAdminUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  const db = supabaseService();
  const [{ data: sources }, { data: counts }] = await Promise.all([
    db
      .from('legal_sources')
      .select('id, name, jurisdiction, feed_url, enabled, last_polled_at, last_status, last_error')
      .order('id'),
    db.from('legal_developments').select('status')
  ]);

  const byStatus = ((counts ?? []) as { status: string }[]).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {user.email}. These jobs also run on their own schedule; the buttons are for
          when you need an answer now rather than in six hours.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Corpus</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['discovered', 'extracted', 'approved', 'published', 'rejected'].map((status) => (
            <Badge key={status} variant={status === 'extracted' ? 'secondary' : 'outline'}>
              {status}: {byStatus[status] ?? 0}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sources</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {((sources ?? []) as SourceRow[]).map((source) => (
            <div key={source.id} className="grid gap-1 border-b pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{source.name}</span>
                <Badge variant="outline">{source.jurisdiction}</Badge>
                {/* A source that has never been polled is not "ok" and
                    must not look like it. */}
                <Badge
                  variant={source.last_status === 'ok' ? 'secondary' : 'outline'}
                  className={source.last_status === 'error' ? 'border-destructive text-destructive' : ''}
                >
                  {source.last_status ?? 'never polled'}
                </Badge>
                {!source.enabled ? <Badge variant="outline">disabled</Badge> : null}
              </div>
              <code className="break-all text-xs text-muted-foreground">{source.feed_url}</code>
              {source.last_error ? (
                <p className="text-xs text-destructive">{source.last_error}</p>
              ) : null}
              {source.last_polled_at ? (
                <p className="text-xs text-muted-foreground">
                  last polled {new Date(source.last_polled_at).toISOString()}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run a job</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          {JOBS.map((job) => (
            <CronRunButton key={job.path} path={job.path} label={job.label} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
