-- The provenance I added in code was never added to the database.
--
-- `linked-offsite` was introduced two commits ago so that a policy the
-- site itself links to on another hostname — Google's at
-- policies.google.com, a French subsidiary pointing at the group's
-- notice — stops being reported as "this site links to no privacy
-- policy". The TypeScript union got the new member. This CHECK
-- constraint did not.
--
-- So the feature works right up to the last step and then throws the
-- answer away: the link is found, that origin's robots.txt is read and
-- obeyed, the document is fetched and parsed, and the snapshot insert is
-- rejected. lefigaro.fr and rfi.fr both did exactly that on the 00:20
-- run, and both were recorded as "our own storage failed".
--
-- Which is worse than it sounds, because the commit immediately before
-- this one taught the observatory to EXCLUDE that failure code from the
-- study — correctly, since a rejected insert says nothing about a
-- website. The two defects compose: a bug I shipped silently removes
-- real readings from a published sample, and the instrument built to
-- stop absences passing for results is the thing that hides it.
--
-- The constraint and the union are now pinned to each other by a test,
-- because the lesson is not "add the value", it is that a type in one
-- language and a CHECK in another drifted without anything noticing.

alter table public.scan_snapshots
  drop constraint if exists scan_snapshots_provenance_check;

alter table public.scan_snapshots
  add constraint scan_snapshots_provenance_check
  check (
    provenance = any (
      array[
        'linked-from-homepage'::text,
        'linked-offsite'::text,
        'listed-in-sitemap'::text,
        'conventional-path'::text
      ]
    )
  );

comment on column public.scan_snapshots.provenance is
  'How the document was found: the site''s own link, its own link to another hostname, its sitemap, or a path we guessed. Must match the Provenance union in src/lib/policy-discovery.ts — tests/policy-discovery.test.ts enforces that the two lists agree.';
