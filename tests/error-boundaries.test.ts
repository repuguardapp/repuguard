import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * React render errors had no path to Sentry at all.
 *
 * next.config.mjs disables Sentry's automatic App Directory
 * instrumentation — it raced with our body reads on Fluid Compute and
 * produced "Raw body unavailable" 400s on every POST to a route
 * handler. That fix was right, and it means nothing reports itself:
 * every signal we get has to be sent by code we wrote. With no error
 * boundary in the tree, Next.js rendered its own bare page and told
 * nobody.
 *
 * These are declaration checks. A boundary that silently stops
 * reporting looks exactly like an application with no errors, which is
 * the failure mode this whole layer exists to remove.
 */

const root = join(__dirname, '..');

const BOUNDARIES = [
  // Replaces the root layout: fires for an error in the layout itself.
  'src/app/global-error.tsx',
  // Fires for anything inside a localized page, which is where errors
  // actually happen.
  'src/app/[locale]/error.tsx'
];

describe('render errors reach Sentry', () => {
  for (const file of BOUNDARIES) {
    describe(file, () => {
      const path = join(root, file);

      it('exists', () => {
        expect(existsSync(path), `${file} is missing`).toBe(true);
      });

      it('is a client component and reports the error', () => {
        const source = readFileSync(path, 'utf8');
        // Error boundaries only work in client components.
        expect(source.startsWith("'use client'")).toBe(true);
        expect(source).toContain('@sentry/nextjs');
        expect(source).toContain('captureException');
      });

      it('offers the customer a way out', () => {
        const source = readFileSync(path, 'utf8');
        // `reset` re-renders the segment. A dead end that only says
        // "something went wrong" makes the customer reach for support
        // over something a retry would have fixed.
        expect(source).toContain('reset');
      });
    });
  }

  it('keeps the root boundary free of the things that may have broken', () => {
    // global-error replaces the ROOT layout, so it renders exactly when
    // the locale, the message bundle and the i18n provider are gone. An
    // error page that needs the thing that just broke is not an error
    // page.
    const source = readFileSync(join(root, 'src/app/global-error.tsx'), 'utf8');
    expect(source).not.toContain('next-intl');
    expect(source).toContain('<html');
    expect(source).toContain('<body');
  });
});

describe('a 404 is a page, not a blank screen', () => {
  const path = join(root, 'src/app/not-found.tsx');

  it('exists at the app root', () => {
    // notFound() looks for [locale]/not-found.tsx, then
    // app/not-found.tsx, then falls back to Next's built-in — which
    // renders a bare <div> and relies on a layout for the document
    // around it.
    expect(existsSync(path), 'src/app/not-found.tsx is missing').toBe(true);
  });

  it('renders its own document, because the root layout does not', () => {
    // src/app/layout.tsx returns `children` untouched so the locale
    // layout can own <html lang> and <html dir> and serve LTR and RTL
    // from one shell. Reasonable on its own, fatal for a 404: the
    // response had no <html> and no <body>, which every browser shows
    // as a blank white page.
    //
    // Every wrong URL on the site was blank since launch — a stale
    // search-engine link, a deleted audit, an admin page refusing a
    // visitor not on the allowlist. It took three investigations to
    // notice, because a blank page looks like an outage, a broken
    // session and a misconfigured variable all at once.
    const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('return children');

    const source = readFileSync(path, 'utf8');
    expect(source).toContain('<html');
    expect(source).toContain('<body');
  });

  it('needs no locale and no dependency to render', () => {
    // A 404 is reachable at a path with no locale segment, so there is
    // no reliable locale to translate into and nothing to load that
    // could itself fail.
    const source = readFileSync(path, 'utf8');
    expect(source).not.toContain('next-intl');
    expect(source).not.toContain('@/components');
    expect(source).not.toContain('@/lib');
  });

  it('keeps itself out of the index', () => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('index: false');
  });
});
