/**
 * The licence the observatory dataset is published under.
 *
 * Its own module, and deliberately not `server-only`, because three
 * places state it to the outside world — the Zenodo record, the
 * data.gouv.fr dataset page and our own schema.org markup — and two of
 * those are permanent public artefacts. A licence written down twice is
 * one place too many to get it wrong, and `observatory.ts` cannot be
 * imported by anything that needs to be read without a server.
 *
 * Re-exported from `observatory.ts` so existing importers are unchanged.
 */
export const OBSERVATORY_LICENCE = 'https://creativecommons.org/licenses/by/4.0/';
