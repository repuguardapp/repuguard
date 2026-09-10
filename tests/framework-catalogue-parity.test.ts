import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMEWORKS } from '../src/lib/legal-frameworks';

/**
 * Every framework the application offers must exist in the database.
 *
 * `audit_findings.framework_id` is a foreign key onto
 * `public.legal_frameworks`. The seed migration shipped 7 of the 13
 * frameworks in the application catalogue — the six Gulf regimes were
 * missing — and nothing anywhere connected the two. The picker offered
 * Saudi PDPL, Claude audited against it, and then the findings insert
 * (a single batch) failed wholesale on the foreign key. The failure was
 * best-effort and non-fatal, so the audit still saved as `completed`
 * with an empty findings list, which the UI renders as "no findings —
 * your document is compliant", under a risk score of 78/100.
 *
 * A missing seed row is invisible in every environment until a customer
 * selects that jurisdiction. This test makes the drift fail in CI
 * instead — it reads the migrations as text, so it needs no database.
 */

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

/** ids inserted into legal_frameworks across all numbered migrations. */
function seededFrameworkIds(): Set<string> {
  const ids = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f))) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Take each `insert into ... legal_frameworks ...` statement up to
    // its terminating semicolon, then collect the first quoted value of
    // every tuple — that column is the id.
    const statements = sql.matchAll(
      /insert\s+into\s+public\.legal_frameworks[\s\S]*?;/gi
    );
    for (const [statement] of statements) {
      for (const [, id] of statement.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/gi)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

describe('legal framework catalogue ↔ database seed parity', () => {
  it('seeds every framework the application can offer', () => {
    const seeded = seededFrameworkIds();
    const missing = FRAMEWORKS.map((f) => f.id).filter((id) => !seeded.has(id));

    expect(
      missing,
      `Offered in src/lib/legal-frameworks.ts but never inserted into ` +
        `public.legal_frameworks. audit_findings.framework_id is a foreign ` +
        `key onto that table, so findings citing these are silently ` +
        `discarded: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('does not seed frameworks the application no longer knows about', () => {
    // The reverse drift is milder — an orphan row breaks nothing — but
    // it usually means a framework was renamed and the old id is still
    // referenced by historical findings.
    const known = new Set(FRAMEWORKS.map((f) => f.id));
    const orphans = [...seededFrameworkIds()].filter((id) => !known.has(id));

    expect(orphans, `Seeded but absent from the application catalogue`).toEqual([]);
  });
});
