/**
 * Single source of truth for the sub-processors LexyFlow uses.
 *
 * Mirrors what the Privacy Policy and DPA reference; both pages should
 * be updated alongside this file when a new sub-processor is added or
 * removed (we promise customers 30 days' notice on changes).
 *
 * Structural facts only. What each provider does, where it sits and why
 * we use it are prose, and prose belongs in the message catalogue — the
 * page is read by procurement teams in seven countries, and it was
 * English in all of them. `id` is the key that joins the two.
 */

export type DataCategory = 'document_text' | 'account' | 'billing' | 'email' | 'errors';

export type SubProcessorId =
  | 'anthropic'
  | 'openai'
  | 'supabase'
  | 'stripe'
  | 'vercel'
  | 'resend'
  | 'sentry';

export interface SubProcessor {
  /** Catalogue key for the translated role, region and purpose. */
  id: SubProcessorId;
  name: string;
  legalName: string;
  url: string;
  /** What we actually send to this provider. */
  dataCategories: readonly DataCategory[];
  certifications: readonly string[];
  /** Cross-border transfer mechanism, if any. Proper nouns only. */
  transferMechanism?: string;
  dpaUrl?: string;
}

export const SUB_PROCESSORS: readonly SubProcessor[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    legalName: 'Anthropic, PBC',
    url: 'https://www.anthropic.com',
    dataCategories: ['document_text'],
    certifications: ['SOC 2 Type II', 'ISO 27001', 'HIPAA-aligned'],
    transferMechanism: 'EU SCCs (2021/914) + UK IDTA',
    dpaUrl: 'https://www.anthropic.com/legal/dpa'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    legalName: 'OpenAI, L.L.C.',
    url: 'https://openai.com',
    dataCategories: ['document_text'],
    certifications: ['SOC 2 Type II', 'ISO 27001'],
    transferMechanism: 'EU SCCs (2021/914) + UK IDTA',
    dpaUrl: 'https://openai.com/policies/data-processing-addendum'
  },
  {
    id: 'supabase',
    name: 'Supabase',
    legalName: 'Supabase Inc.',
    url: 'https://supabase.com',
    dataCategories: ['account', 'errors'],
    certifications: ['SOC 2 Type II', 'HIPAA-aligned'],
    dpaUrl: 'https://supabase.com/legal/dpa'
  },
  {
    id: 'stripe',
    name: 'Stripe',
    legalName: 'Stripe Payments Europe Ltd.',
    url: 'https://stripe.com',
    dataCategories: ['billing'],
    certifications: ['PCI DSS Level 1', 'SOC 2 Type II', 'ISO 27001'],
    dpaUrl: 'https://stripe.com/legal/dpa'
  },
  {
    id: 'vercel',
    name: 'Vercel',
    legalName: 'Vercel Inc.',
    url: 'https://vercel.com',
    dataCategories: ['account', 'errors'],
    certifications: ['SOC 2 Type II', 'ISO 27001', 'HIPAA-aligned'],
    transferMechanism: 'EU SCCs (2021/914)',
    dpaUrl: 'https://vercel.com/legal/dpa'
  },
  {
    id: 'resend',
    name: 'Resend',
    legalName: 'Resend Labs Inc.',
    url: 'https://resend.com',
    dataCategories: ['email'],
    certifications: ['SOC 2 Type II'],
    transferMechanism: 'EU SCCs (2021/914)',
    dpaUrl: 'https://resend.com/legal/dpa'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    legalName: 'Functional Software Inc. (dba Sentry)',
    url: 'https://sentry.io',
    dataCategories: ['errors'],
    certifications: ['SOC 2 Type II', 'ISO 27001', 'HIPAA-aligned'],
    transferMechanism: 'EU SCCs (2021/914)',
    dpaUrl: 'https://sentry.io/legal/dpa'
  }
];
