import 'server-only';

/**
 * The state of the last CI run on the default branch.
 *
 * This exists because the pipeline was red from 28 April to 5 October —
 * ninety-seven consecutive failures — and nothing in this product ever
 * said so. The digest reported audits, credits, feed health, the review
 * queue and the corpus every morning, and was silent about the one
 * instrument whose entire job is to say whether the code works. GitHub
 * e-mailed every failure to the operator, who reasonably reads those the
 * way anyone reads a channel that has cried wolf for five months.
 *
 * A number that is wrong is worse than no number. A number that is
 * missing from a report whose purpose is completeness is the same
 * failure, one level up.
 *
 * NO TOKEN, ON PURPOSE
 *
 * The repository is public, so the Actions API answers unauthenticated.
 * The digest runs once a day against a sixty-per-hour limit, which is
 * not close. Requiring a personal access token would have made this
 * depend on somebody creating and rotating a credential for a read-only
 * fact that is already public — and a monitor nobody can set up is a
 * monitor that does not exist.
 */

/** Where the workflow lives. Public, so this is not a secret. */
const REPO = 'repuguardapp/repuguard';
const WORKFLOW = 'ci.yml';
const BRANCH = 'main';
const TIMEOUT_MS = 8_000;

export interface CiStatus {
  /** 'success', 'failure', 'cancelled', 'timed_out'… or null while running. */
  conclusion: string | null;
  /** 'completed', 'in_progress', 'queued'. */
  status: string;
  sha: string;
  /** The commit subject, so the line is readable without opening GitHub. */
  title: string;
  startedAt: string;
  url: string;
  /**
   * Consecutive non-success runs ending at this one, over the page we
   * read. One failure is a bad afternoon; eleven in a row is a pipeline
   * nobody is watching, and the difference is the whole point of this
   * field. Capped by the page size, so it reads "at least".
   */
  failingStreak: number;
}

/** Null means we could not read it — never "everything is fine". */
export async function latestCiRun(): Promise<CiStatus | null> {
  const url =
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs` +
    `?branch=${BRANCH}&per_page=20`;

  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'LexyFlowOps/1.0 (+https://lexyflow.com)'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store'
    });

    if (!res.ok) {
      console.error('[ci-status] read_failed', { status: res.status });
      return null;
    }

    const body = (await res.json()) as {
      workflow_runs?: {
        status?: string;
        conclusion?: string | null;
        head_sha?: string;
        display_title?: string;
        run_started_at?: string;
        created_at?: string;
        html_url?: string;
      }[];
    };

    const runs = body.workflow_runs ?? [];
    const latest = runs[0];
    if (!latest) return null;

    // Counted over completed runs only: a run still in progress has no
    // verdict yet and must not be read as either outcome.
    let streak = 0;
    for (const run of runs) {
      if (run.status !== 'completed') continue;
      if (run.conclusion === 'success') break;
      streak += 1;
    }

    return {
      conclusion: latest.conclusion ?? null,
      status: latest.status ?? 'unknown',
      sha: (latest.head_sha ?? '').slice(0, 7),
      title: (latest.display_title ?? '').split('\n')[0]!.slice(0, 80),
      startedAt: latest.run_started_at ?? latest.created_at ?? '',
      url: latest.html_url ?? `https://github.com/${REPO}/actions`,
      failingStreak: streak
    };
  } catch (err) {
    console.error('[ci-status] read_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
