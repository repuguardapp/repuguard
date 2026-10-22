import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { FRAMEWORKS } from '@/lib/legal-frameworks';

/**
 * What the product is, in a form a machine can read.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY
 *
 * `aggregateRating` and `review`. Google's structured-data report asks
 * for them on this type and will keep asking. Supplying them would mean
 * inventing ratings for a product that has had no customers, which is
 * the one thing this repository does not do — the same request was
 * refused on the product markup once already, and the markup was
 * removed rather than filled.
 *
 * `offers` too, for a quieter reason. Prices are real and come from
 * Stripe, but they are per-currency and change there without changing
 * here. A price hardcoded in markup is a claim that drifts silently
 * into being false, and the pricing page already states them from the
 * source of truth. A field we cannot keep honest stays out.
 *
 * WHAT IS HERE IS COUNTED, NOT ASSERTED
 *
 * The language list and the framework count are derived from the same
 * constants the application runs on, so the markup cannot drift from
 * the product. That is not decoration: the homepage claimed "six native
 * languages" in five of its seven translations while the Arabic one
 * correctly said seven, and nothing caught it because the sentence was
 * hand-written in each file. Anything countable here is counted.
 */
export function softwareApplicationSchema(origin: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'LexyFlow',
    url: origin,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Regulatory compliance',
    operatingSystem: 'Web browser',
    description,
    // Counted from NATIVE_LOCALE_CODES rather than typed out.
    inLanguage: [...NATIVE_LOCALE_CODES],
    featureList: FRAMEWORKS.map((f) => f.id),
    provider: {
      '@type': 'Organization',
      name: 'LexyFlow',
      url: origin
    },
    /**
     * The free tier, stated as a capability rather than a price.
     *
     * This is checkable and it is what a reader actually needs: the
     * scan runs without an account. It makes no claim about what the
     * paid plans cost, which is the part that would drift.
     */
    isAccessibleForFree: true
  };
}
