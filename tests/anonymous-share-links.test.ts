import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A feature documented in four files and implemented in none.
 *
 * `/embed/audit` lets anybody run a one-shot audit with no account. The
 * audit route skips its org-spoof guard for the anonymous UUID on
 * purpose; the paywall module, the report page, the edit page and the
 * audit API all branch on it as "public by UUID, never paywalled".
 *
 * Nothing ever let anyone READ one. Every SELECT policy on the three
 * audit tables compared organization_id to the JWT's app_metadata, a
 * visitor with no session has no JWT, the COALESCE falls to '', and ''
 * never equals the anonymous UUID.
 *
 * So the widget would have created the audit, redirected the visitor to
 * the report, and the database would have refused them the row — the
 * same "Page not found" a new customer hit for a different reason. It
 * was never seen because the anonymous org holds zero audits: the
 * feature has a producer, a consumer, four branches of handling, and has
 * never once run.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const MIGRATION = read('supabase/migrations/0052_anonymous_share_links.sql');
/** The statements alone. The comment block quotes the id too, and a
 *  count that includes prose measures the explanation, not the grant. */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');
const ANON = '00000000-0000-0000-0000-000000000000';

describe('the share link can be read, and nothing else can', () => {
  it('covers all three tables the report page reads', () => {
    // Widening `audits` alone would have produced a report page with a
    // header and no findings: the other two inline the same member
    // condition rather than deriving it.
    for (const table of ['public.audits', 'public.audit_findings', 'public.audit_translations']) {
      expect(SQL).toContain(`on ${table} for select`);
    }
  });

  it('grants select and nothing else', () => {
    // Writing stays with the service role.
    expect(SQL).not.toMatch(/for (insert|update|delete)/i);
    expect((SQL.match(/for select/g) ?? []).length).toBe(3);
  });

  it('is bound to a literal id, so it cannot reach a real organisation', () => {
    expect((SQL.match(new RegExp(ANON, 'g')) ?? []).length).toBe(3);
    // No parameter, no column comparison, no subquery that could widen.
    expect(SQL).not.toContain('auth.jwt()');
  });
});

describe('the code and the policy agree on what is public', () => {
  it('uses one constant for the anonymous org', () => {
    expect(read('src/lib/paywall.ts')).toContain(`ANONYMOUS_ORG_ID = '${ANON}'`);
  });

  it('matches the id the audit route skips its spoof guard for', () => {
    // If these two ever drift, the route creates rows under an id the
    // policy does not publish, and the feature breaks silently again.
    expect(read('src/app/api/audit/route.ts')).toContain(ANON);
  });

  it('matches the id the report page treats as never paywalled', () => {
    expect(read('src/app/[locale]/dashboard/[auditId]/page.tsx')).toContain('ANONYMOUS_ORG_ID');
  });

  it('records the paywall escape it does not fix', () => {
    // A signed-in user may still submit with organizationId set to the
    // anonymous UUID: the spoof guard skips that branch by design, so
    // their report becomes public by UUID and escapes the paywall.
    // Predates this migration, stated rather than left.
    expect(MIGRATION).toContain('escapes the paywall');
  });
});
