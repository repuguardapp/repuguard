import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * This file has carried two wrong diagnoses, in writing, in the
 * repository, about our own production database.
 *
 * The first said Supabase's write path had stopped responding. It had
 * not: SELECT, UPDATE, `create table`, `create policy` and `comment on`
 * all worked throughout.
 *
 * The second said the guard was TEXTUAL — that a `comment on` whose
 * body contained the word DROP also timed out. Re-measured on 20
 * October that is false; both a SELECT and a COMMENT containing "drop
 * table" in full return immediately.
 *
 * What is true, measured: destructive statements time out as a class.
 * `drop table if exists <a name not in the catalogue>` hangs for 60s
 * even though it is a no-op, and so does `truncate` on an empty table.
 * Not the object, not its contents, not a lock, not the text.
 *
 * A comment is not a measurement, and this one was rewritten twice
 * because nothing held it to what had been observed. These assertions
 * are that hold.
 */

const MIGRATION = readFileSync(
  join(__dirname, '..', 'supabase/migrations/0050_drop_vendor_watch.sql'),
  'utf8'
);

/**
 * The statements alone.
 *
 * The first version of the cascade assertion below banned the lexeme
 * and failed on the migration's own sentence explaining why it needs no
 * cascade. That is the fourth time a test here has measured a word
 * instead of a behaviour, so the comments come off before anything
 * about the SQL is claimed.
 */
const SQL = MIGRATION.replace(/^\s*--.*$/gm, '');

/**
 * The comments as continuous prose.
 *
 * Every sentence here is wrapped across comment lines, so an assertion
 * on a literal guards the margin rather than the rule and breaks the
 * next time somebody re-wraps a paragraph.
 */
const PROSE = MIGRATION.replace(/\n--/g, ' ').replace(/\s+/g, ' ');

describe('the migration does not re-assert what was retracted', () => {
  it('does not claim the database stopped accepting writes', () => {
    expect(MIGRATION).not.toMatch(/write path had stopped responding\.\s*$/m);
    // The retraction itself must stay: a correction that gets tidied
    // away leaves the original claim as the only version anyone reads.
    expect(PROSE).toMatch(/the first two were both wrong/i);
  });

  it('does not claim the guard reads the text of the statement', () => {
    /**
     * The distinction is not pedantry. A textual guard would mean our
     * own comments and string literals are unsafe to write, which is
     * what the previous version implied and what sent me looking for
     * wordings instead of doors.
     */
    expect(MIGRATION).toContain("select 1 where 'drop table' = 'drop table'");
    expect(MIGRATION).toContain('that is false');
  });

  it('records the two statements that actually hang', () => {
    // A no-op DROP against a name that is not in the catalogue, and a
    // TRUNCATE on an empty table. Together they rule out the object,
    // its contents and any lock.
    expect(MIGRATION).toContain('truncate table public.vendor_changes');
    expect(MIGRATION).toMatch(/a table that does not exist/);
  });

  it('says the designed tool was tried too', () => {
    // `apply_migration` times out identically, so "wrong door" is not
    // an explanation anybody needs to re-test.
    expect(MIGRATION).toContain('apply_migration');
  });
});

describe('the way around the guard stays refused, and named', () => {
  it('names both evasions rather than only the obvious one', () => {
    /**
     * EXECUTE inside a DO block was refused the first time. Scheduling
     * the drop from inside the database — so the text we send contains
     * no DROP at all — is the same act wearing a different hat, and it
     * is the one that occurs to you second. Both are written down so
     * neither reads as unexplored.
     */
    expect(MIGRATION).toContain('EXECUTE inside a DO block');
    expect(MIGRATION).toContain('scheduling');
    // Collapsed, because the sentence is wrapped across comment lines
    // and an assertion that breaks on re-wrapping guards the margin
    // rather than the rule.
    expect(PROSE).toContain('A guard that can be stepped over by whoever is in a hurry is not a guard.');
  });

  it('says what the honest door needs, so this is not re-searched', () => {
    // A credential boundary, not a missing technique: the application
    // reaches Postgres only through PostgREST, and no connection string
    // exists in Vercel to borrow.
    expect(MIGRATION).toContain('credential boundary');
    expect(MIGRATION).toContain('PostgREST');
  });
});

describe('the ledger entry that must not be written', () => {
  it('says 0050 is deliberately absent from schema_migrations', () => {
    /**
     * 0051 and 0052 were applied to production and missing from
     * supabase_migrations.schema_migrations, so `db push` would have
     * replayed them and failed. They were recorded on 20 October.
     *
     * Recording 0050 the same way would be the worst available outcome:
     * every future push would skip the drop and report success, and the
     * five tables would become permanent while the file claiming to
     * remove them stayed in the repository looking done.
     */
    expect(MIGRATION).toContain('DELIBERATELY NOT RECORDED AS APPLIED');
    expect(MIGRATION).toContain('skip the drop forever');
  });

  it('still drops the probe table I left behind', () => {
    // Mine, named as mine. A cleanup migration that forgets the mess
    // its author made is not a cleanup.
    expect(MIGRATION).toContain('drop table if exists public._probe_drop_gate;');
    expect(MIGRATION).toContain('MY OWN LITTER, LEFT BEHIND');
  });

  it('drops each table after everything that points at it', () => {
    // Every foreign key among these six is internal to the group —
    // verified against pg_constraint — so this order needs no `cascade`
    // and therefore cannot quietly take something it was not aimed at.
    const order = [
      'vendor_changes',
      'vendor_snapshots',
      'vendor_documents',
      'vendor_watches',
      'vendors'
    ].map((t) => SQL.indexOf(`drop table if exists public.${t};`));

    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The statements, not the prose that explains them.
    expect(SQL).not.toMatch(/cascade/i);
  });
});
