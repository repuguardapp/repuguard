import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The lifecycle sequence was English-only while the product shipped in
 * seven languages and the org row already carried `ui_locale`.
 *
 * A prospect in Riyadh chose Arabic in the product, got an Arabic
 * report back, and was then nurtured in English — by a company whose
 * whole pitch is that it works in their jurisdiction and their
 * language. Arabic was not even a member of the email locale type,
 * months after we shipped six Gulf frameworks.
 */

vi.mock('server-only', () => ({}));

const sent: { to: string; subject: string; text: string; html: string }[] = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (args: { to: string; subject: string; text: string; html: string }) => {
        sent.push(args);
        return { data: { id: 'msg_1' }, error: null };
      }
    };
  }
}));

vi.mock('../src/lib/supabase', () => ({ supabaseService: () => ({}) }));

const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;

beforeEach(() => {
  sent.length = 0;
  vi.resetModules();
  process.env['RESEND_API_KEY'] = 'test-key';
  process.env['NEXT_PUBLIC_APP_URL'] = 'https://lexyflow.com';
});

const UPGRADE = {
  auditId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  riskScore: 88,
  findingsCount: 5,
  wasPaywalled: true,
  frameworkNames: ['GDPR', 'Saudi PDPL']
};

describe('every locale has complete lifecycle copy', () => {
  it('translates all three emails, with no locale silently reusing English', async () => {
    const { lifecycleStringsFor } = await import('../src/lib/email-lifecycle-i18n');
    const en = lifecycleStringsFor('en');

    for (const locale of LOCALES) {
      const t = lifecycleStringsFor(locale);
      for (const key of ['welcomeSubject', 'nudgeSubject', 'upgradeSubjectSeen'] as const) {
        expect(t[key], `${locale}.${key} is empty`).toBeTruthy();
        if (locale !== 'en') {
          // A locale that returns the English string is a missing
          // translation wearing a costume.
          expect(t[key], `${locale}.${key} is still English`).not.toBe(en[key]);
        }
      }
    }
  });

  it('falls back to English for a locale we do not ship', async () => {
    const { lifecycleStringsFor } = await import('../src/lib/email-lifecycle-i18n');
    expect(lifecycleStringsFor('sv').welcomeSubject).toBe(
      lifecycleStringsFor('en').welcomeSubject
    );
    expect(lifecycleStringsFor(null).welcomeSubject).toBe(lifecycleStringsFor('en').welcomeSubject);
  });
});

describe('Arabic is a first-class locale, not an afterthought', () => {
  it('renders the lifecycle email right-to-left', async () => {
    const { sendLifecycleWelcome } = await import('../src/lib/email');
    await sendLifecycleWelcome('reader@example.sa', 'ar');
    const mail = sent.at(-1)!;

    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain('text-align:right');
    expect(mail.subject).toContain('LexyFlow');
    // Arabic script actually present, not a transliteration.
    expect(/[؀-ۿ]/.test(mail.subject)).toBe(true);
  });

  it('renders the sign-in email right-to-left too', async () => {
    // The first email anyone from the Gulf ever receives from us. It
    // had no Arabic entry at all, so it silently served English.
    const { sendMagicLinkEmail } = await import('../src/lib/email');
    await sendMagicLinkEmail({ to: 'reader@example.sa', link: 'https://lexyflow.com/x', locale: 'ar' });
    const mail = sent.at(-1)!;

    expect(mail.html).toContain('dir="rtl"');
    expect(/[؀-ۿ]/.test(mail.subject)).toBe(true);
  });

  it('keeps the numbers intact in the upgrade email', async () => {
    const { sendLifecycleUpgrade } = await import('../src/lib/email');
    await sendLifecycleUpgrade('reader@example.sa', { ...UPGRADE, locale: 'ar' });
    const mail = sent.at(-1)!;

    // 4 of 5 withheld. Localising the prose must not lose the fact.
    expect(mail.subject).toContain('4');
    expect(mail.text).toContain('88/100');
    expect(mail.text).toContain('Saudi PDPL');
  });
});

describe('links follow the reader into their own language', () => {
  it.each(LOCALES)('sends a %s reader to a %s page', async (locale) => {
    const { sendLifecycleWelcome } = await import('../src/lib/email');
    await sendLifecycleWelcome('reader@example.com', locale);
    const mail = sent.at(-1)!;

    // An Arabic email linking to /en/audit undoes the translation on
    // the click.
    expect(mail.text).toContain(`https://lexyflow.com/${locale}/audit`);

    // And no link in the body points at any OTHER locale.
    const linkedLocales = [...mail.text.matchAll(/lexyflow\.com\/([a-z-]+)\//g)].map((m) => m[1]);
    expect(linkedLocales.length).toBeGreaterThan(0);
    expect([...new Set(linkedLocales)]).toEqual([locale]);
  });

  it('sends the upgrade reader to their own report in their own language', async () => {
    const { sendLifecycleUpgrade } = await import('../src/lib/email');
    await sendLifecycleUpgrade('reader@example.com', { ...UPGRADE, locale: 'fr' });
    const mail = sent.at(-1)!;

    expect(mail.text).toContain(`https://lexyflow.com/fr/dashboard/${UPGRADE.auditId}`);
    expect(mail.text).toContain('https://lexyflow.com/fr/pricing');
  });
});
