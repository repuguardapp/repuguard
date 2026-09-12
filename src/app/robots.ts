import type { MetadataRoute } from 'next';

/**
 * Crawler policy.
 *
 * Three tiers:
 *   1. Search engine bots (`*`) — full marketing surface allowed,
 *      private surfaces (dashboard, api, admin, embed) disallowed.
 *   2. AI training bots — explicitly disallowed everywhere. Our content
 *      is the basis of a paid product; we do not consent to it being
 *      used as model training data.
 *   3. Sentry tunnel and operational paths — disallowed for everyone.
 *
 * The list of AI bot user-agents is maintained from
 * <https://github.com/ai-robots-txt/ai.robots.txt>; we keep the most
 * common offenders inline for transparency.
 */

const PRIVATE_PATHS = ['/api/', '/dashboard/', '/admin/', '/onboarding', '/monitoring/', '/embed/'];

/**
 * Every private path, in both the shape it is written above and the
 * shape it actually has on the site.
 *
 * The middleware forces a locale prefix onto every non-API request, so
 * the real URL of the dashboard is /en/dashboard, not /dashboard.
 * robots.txt matches on a literal prefix from the root, which means
 * this file spent its life disallowing paths that redirect and
 * allowing the ones that exist. Every private surface was crawlable.
 *
 * `/*\/dashboard/` covers all seven locales in one line — the wildcard
 * is honoured by Google and Bing. The unprefixed form is kept because
 * /api/ genuinely is unprefixed (middleware skips it) and because a
 * redirect is still a URL a crawler can request.
 */
const DISALLOW = PRIVATE_PATHS.flatMap((path) => [path, `/*${path}`]);

const AI_TRAINING_USER_AGENTS = [
  'GPTBot',           // OpenAI
  'ChatGPT-User',     // OpenAI ChatGPT browsing
  'OAI-SearchBot',    // OpenAI search
  'CCBot',            // Common Crawl (used by many model trainers)
  'ClaudeBot',        // Anthropic Claude crawler
  'Claude-Web',       // Anthropic web fetcher
  'Google-Extended',  // Google generative AI training opt-out
  'Applebot-Extended',// Apple AI training
  'Amazonbot',        // Amazon AI
  'PerplexityBot',
  'YouBot',
  'cohere-ai',
  'Bytespider',       // ByteDance
  'FacebookBot',      // Meta crawler used for training
  'Meta-ExternalAgent',
  'Diffbot',
  'AwarioRssBot',
  'Omgilibot',
  'omgili'
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lexyflow.com';

  return {
    rules: [
      // Search engines: marketing surface only.
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      // AI crawlers: blanket block.
      ...AI_TRAINING_USER_AGENTS.map((ua) => ({ userAgent: ua, disallow: '/' }))
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base
  };
}
