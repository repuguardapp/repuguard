import { appUrl } from '@/lib/app-url';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { FRAMEWORKS } from '@/lib/legal-frameworks';

/**
 * /llms.txt — what this site is, for an agent reading it.
 *
 * THE TENSION THIS FILE SITS IN, STATED RATHER THAN HIDDEN
 *
 * robots.ts disallows nineteen AI user agents, and three of them —
 * OAI-SearchBot, ChatGPT-User, PerplexityBot — are RETRIEVAL agents,
 * not training crawlers. They fetch a page because somebody asked a
 * question. So this file currently addresses an audience the site
 * turns away at the door.
 *
 * That is a policy decision, not an oversight, and it is not mine to
 * reverse inside an SEO commit. The split that would make both
 * coherent — refuse training, allow citation — is written up for the
 * operator rather than applied here. The file ships anyway: it costs
 * nothing, it is read by agents we do not block and by people, and it
 * is the half of the pair that is unambiguously ours to build.
 *
 * WHAT IT SAYS, AND WHAT IT REFUSES TO
 *
 * Facts that are counted from the application's own constants, and
 * links to pages that carry their sources. No adjectives about the
 * product, no claims about customers, no numbers that would need
 * maintaining in two places. An agent summarising this should be able
 * to check every sentence against a page.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export function GET() {
  const origin = appUrl();

  const body = `# LexyFlow

> Automated compliance audits of policies, contracts and model cards
> against published regulatory frameworks, with every finding tied to
> the provision it rests on.

LexyFlow reads a document and reports what it does and does not say
about ${FRAMEWORKS.length} regulatory frameworks, in ${NATIVE_LOCALE_CODES.length} languages.
Every finding carries the passage it is based on; every published
enforcement decision carries a link to the regulator's own page.

## What you can check without an account

- ${origin}/en/scan — read any domain's privacy policy against seven
  published obligations. No account, no key. Free, with a daily ceiling.
- ${origin}/en/embed — the same check as an iframe for your own site.
- ${origin}/en/decisions — enforcement decisions from data-protection
  and AI regulators, summarised, each linking to the original.
- ${origin}/en/observatory — a survey of privacy policies published by
  high-traffic .fr domains, deposited with a DOI.
- ${origin}/api/public/decisions — the decisions above as JSON.

## Frameworks covered

${FRAMEWORKS.map((f) => `- ${f.id}`).join('\n')}

## Languages

${NATIVE_LOCALE_CODES.join(', ')}. Arabic renders right-to-left.
Any path is available under any of these prefixes, and every page
carries hreflang alternates for all of them.

## How to cite what you find here

Summaries on ${origin}/en/decisions are ours; the decisions are the
regulators'. Where the two differ the original governs, and its URL is
on every page. The observatory dataset has a concept DOI that always
resolves to its latest version.

## What this site will not tell you

It publishes no ratings and no customer counts, because there are none
to report. It publishes nothing about a named organisation that a
regulator has not published first.

## Contact

legal@lexyflow.com for data-protection and contractual matters.
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400'
    }
  });
}
