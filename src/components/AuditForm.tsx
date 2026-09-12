'use client';

import { useEffect, useId, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NATIVE_LOCALES, NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { cn } from '@/lib/utils';

/**
 * The language a report is most likely wanted in, per jurisdiction.
 *
 * Only unambiguous cases. 'EU' is deliberately absent: it spans
 * twenty-four official languages and guessing one would be worse than
 * suggesting none.
 */
const LANGUAGE_BY_JURISDICTION: Readonly<Record<string, string>> = {
  QA: 'ar',
  SA: 'ar',
  AE: 'ar',
  BH: 'ar',
  KW: 'ar',
  OM: 'ar',
  JP: 'ja',
  BR: 'pt-br',
  UK: 'en',
  CA: 'en',
  'US-CA': 'en'
};

interface FrameworkOption {
  id: string;
  name: string;
  /** ISO-ish jurisdiction tag ('EU', 'SA', 'JP'…), used to suggest a report language. */
  jurisdiction?: string;
}

/**
 * All UX strings for the audit lifecycle. Pulled from `messages/*.json`
 * via the audit/page server component and passed in as a single object
 * — no string is hardcoded in this client component, so the same
 * bundle ships to every locale without divergence.
 */
export interface AuditFormLabels {
  // Form
  upload: string;
  uploadHint: string;
  targetLanguage: string;
  targetLanguageHint: string;
  languageSuggested: string;
  languageOther: string;
  languageOtherPlaceholder: string;
  framework: string;
  frameworkHint: string;
  submit: string;
  running: string;

  // Running card
  processing: {
    queued: string;
    running: string;
    phases: readonly string[]; // rotated client-side every PHASE_INTERVAL_MS
  };

  // Failure card
  failed: {
    title: string;
    tryAgain: string;
    timeout: string;
  };

  /** Localized message per server error code (lookup `errors[code]`).
   *  Includes a `generic` fallback for any code not in the map. */
  errors: Readonly<Record<string, string>>;

  // Kept for backwards compatibility with /audit and /embed/audit
  // building the same bundle. No "completed" card is rendered any more
  // — on success we redirect straight to the dashboard so the user
  // sees the report, not an intermediate confirmation screen.
  completed: {
    title: string;
    riskScore: string;
    findingsCount: string;
    openReport: string;
  };
}

interface Props {
  labels: AuditFormLabels;
  frameworks: FrameworkOption[];
  /**
   * Framework IDs pre-selected on render. Typically computed from the
   * org's country (`frameworksForCountry`) so a Saudi user lands on
   * /audit with `saudi_pdpl` already checked. Empty array → user picks
   * everything manually.
   */
  defaultFrameworkIds?: readonly string[];
  defaultLanguage: string;
  /** Stamped from the server-rendered page so we don't trust the client. */
  organizationId: string;
  /**
   * Current URL locale (e.g. 'fr', 'ar'). The audit API returns
   * redirect URLs without a locale prefix (e.g. `/dashboard/<id>`)
   * because it has no view of the user's UI session. We prepend the
   * locale here so the post-audit landing stays in the same language
   * as the form they just submitted from — otherwise next-intl's
   * middleware would auto-detect from Accept-Language and a French-
   * browser user submitting an Arabic audit would land on /fr/...
   */
  locale: string;
}

type View =
  | { phase: 'idle' }
  | { phase: 'running'; progress: number }
  | { phase: 'failed'; message: string };

/**
 * Client-side cap matches the server's check in `/api/audit/route.ts`
 * (line ~99). We reject early so the user gets immediate, actionable
 * feedback instead of waiting for a multi-megabyte upload only to be
 * rejected — and so the platform's 4.5 MB Vercel body cap never
 * fires a generic network error in our place.
 */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Typed wrapper used purely to mark which throws inside onSubmit
 * already carry a known server error code — anything else is
 * coerced to `generic` in the catch. The String value of `err.code`
 * is the dictionary key for `labels.errors[...]`.
 */
class AuditError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'AuditError';
  }
}

/**
 * Audit form — synchronous architecture.
 *
 * The client POSTs the document to /api/audit and awaits a single
 * response that holds for the full duration of the Multi-Pass run
 * (typically 30-90s, capped at Vercel Pro's 300s function ceiling).
 * On success we redirect to the dashboard. On failure we render a
 * card with the server-supplied error code so the user knows what
 * actually happened.
 *
 * Three states:
 *   idle    — form is editable
 *   running — request in flight; rotating phrase animation on a
 *             pure-client timer (no polling, no setInterval against
 *             the server, no race with Vercel)
 *   failed  — error card with structured message
 *
 * Success has no UI state because we navigate away the moment the
 * fetch resolves — see `window.location.assign(body.redirect)` below.
 */
export function AuditForm({
  labels,
  frameworks,
  defaultFrameworkIds = [],
  defaultLanguage,
  organizationId,
  locale
}: Props) {
  // Prefix a path returned by the audit API with the active UI locale
  // unless it already carries one. Idempotent — calling it twice on
  // `/ar/dashboard/x` still yields `/ar/dashboard/x`.
  const withLocale = (path: string): string => {
    if (!path.startsWith('/')) return path;
    const first = path.split('/')[1] ?? '';
    // If the first segment already looks like a BCP-47 tag (2-5 chars,
    // letters + optional region), trust it and pass through.
    if (/^[a-z]{2}(-[a-z0-9]{2,4})?$/i.test(first)) return path;
    return `/${locale}${path}`;
  };
  const [view, setView] = useState<View>({ phase: 'idle' });
  // Inline file-validation state. Set the moment the user picks a
  // too-large file; cleared on a valid pick. Distinct from `view.phase
  // === 'failed'` because it lives next to the file input — the user
  // never leaves the form, just sees a red note + a disabled submit.
  const [fileIssue, setFileIssue] = useState<{ message: string; size: number; name: string } | null>(null);
  // The selected scope is controlled so the submit button can reflect
  // "nothing ticked" — a checkbox group has no HTML-level `required`
  // that means "at least one of these" (marking each box required
  // would demand all of them).
  const [selectedFrameworks, setSelectedFrameworks] = useState<ReadonlySet<string>>(
    () => new Set(defaultFrameworkIds)
  );

  const [language, setLanguage] = useState(defaultLanguage);
  // True once the customer asks for a language we don't ship a UI in —
  // the engine handles any BCP-47 tag, so the field stays available
  // rather than the chip row quietly becoming the limit of the promise.
  const [customLanguage, setCustomLanguage] = useState(
    () => !NATIVE_LOCALE_CODES.includes(defaultLanguage)
  );

  /**
   * Languages worth offering first, given what is being audited: a
   * Saudi PDPL audit most likely wants an Arabic report, a Japanese
   * APPI audit a Japanese one. The jurisdiction is already on every
   * framework, so this costs nothing and saves the customer from
   * translating our own catalogue in their head.
   */
  const suggestedLanguages = new Set(
    frameworks
      .filter((f) => selectedFrameworks.has(f.id))
      .map((f) => LANGUAGE_BY_JURISDICTION[f.jurisdiction ?? ''])
      .filter((code): code is string => Boolean(code))
  );

  function toggleFramework(id: string) {
    setSelectedFrameworks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (view.phase === 'running') return <RunningCard progress={view.progress} labels={labels} />;
  if (view.phase === 'failed') {
    return <FailedCard message={view.message} labels={labels} />;
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setFileIssue(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      const localized = labels.errors.document_too_large ?? labels.errors.generic ?? 'File too large.';
      setFileIssue({ message: localized, size: file.size, name: file.name });
    } else {
      setFileIssue(null);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Belt-and-braces: the button is disabled for both of these.
    if (fileIssue) return;
    if (selectedFrameworks.size === 0) return;
    // "Other language" with an empty field would post a value the
    // server rejects as invalid metadata — a 400 where the real
    // message is "you haven't told us the language yet".
    if (language.trim().length < 2) return;
    setView({ phase: 'running', progress: 5 });

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/audit', { method: 'POST', body: form });

      // 402 Payment Required: out of credits — honour the redirect.
      if (res.status === 402) {
        const body = (await res.json().catch(() => ({}))) as { redirect?: string };
        window.location.assign(withLocale(body.redirect ?? '/pricing'));
        return;
      }

      // Fast-path errors (rate limit, validation, etc.) come through
      // with proper HTTP status codes and a non-streamed JSON body.
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        // Log technical detail for debugging — UI shows a friendly
        // localized message via labels.errors[code].
        if (body.detail) console.error('[audit] server error detail:', body.error, body.detail);
        throw new AuditError(body.error ?? 'generic');
      }

      // The endpoint accepts the audit and answers immediately:
      //   202 {"ok":true,"auditId":"…","status":"running","redirect":"…"}
      //   200 {"ok":true,"auditId":"…","status":"completed","replay":true,…}
      //
      // There is no stream to read any more. The audit row exists
      // before we get here, so the report page can render its progress
      // and the work survives this tab being closed — which is the
      // whole point of the change.
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        auditId?: string;
        redirect?: string;
        error?: string;
        detail?: string;
      };

      if (!body.ok || !body.redirect) {
        if (body.detail) console.error('[audit] server error detail:', body.error, body.detail);
        throw new AuditError(body.error ?? 'generic');
      }

      // Hand over to the report page rather than waiting here. It is
      // the one place that knows how to render an audit in any state,
      // and landing on it immediately means the address bar now holds
      // something the customer can come back to.
      window.location.assign(withLocale(body.redirect));
      return;
    } catch (err) {
      const code = err instanceof AuditError ? err.code : 'generic';
      if (!(err instanceof AuditError)) console.error('[audit] client error:', err);
      setView({ phase: 'failed', message: code });
    }
  }

  const inputClass =
    'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background';

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Field
        label={labels.upload}
        hint={labels.uploadHint}
        error={fileIssue ? `${fileIssue.message} (${fileIssue.name} · ${formatBytes(fileIssue.size)})` : undefined}
      >
        <input
          type="file"
          name="document"
          required
          accept=".pdf,.docx,.md,.txt"
          onChange={onFileChange}
          aria-invalid={fileIssue ? true : undefined}
          className={cn(
            inputClass,
            'file:mr-3 file:rounded-sm file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium',
            fileIssue && 'border-destructive focus:ring-destructive'
          )}
        />
      </Field>

      {/* Checkboxes, not a <select multiple>. The multi-select required
          a precise long-press-and-drag on tablets, which is how a
          customer asking for GDPR + EU AI Act could believe both were
          selected — and it hid the fact that the server was only ever
          reading the first one. Each box posts its own `frameworks`
          entry, which the route reads with getAll(). */}
      <CheckboxGroup
        legend={labels.framework}
        hint={labels.frameworkHint}
        meta={`${selectedFrameworks.size} / ${frameworks.length}`}
      >
        {frameworks.map((f) => {
          const { short, detail } = splitFrameworkName(f.name);
          const checked = selectedFrameworks.has(f.id);
          return (
            <label
              key={f.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
                'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                checked
                  ? 'border-primary/40 bg-accent'
                  : 'border-input bg-background hover:bg-accent/40'
              )}
            >
              <input
                type="checkbox"
                name="frameworks"
                value={f.id}
                checked={checked}
                onChange={() => toggleFramework(f.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="grid gap-0.5 text-sm leading-snug">
                <span className="font-medium">{short}</span>
                {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
              </span>
            </label>
          );
        })}
      </CheckboxGroup>

      {/* One tap for the languages we ship, a free field for the rest.
          Typing a BCP-47 tag was asking the customer to know a standard
          in order to use the feature — and it hid the promise, which is
          that any language works, not that we accept two letters. */}
      <CheckboxGroup legend={labels.targetLanguage} hint={labels.targetLanguageHint}>
        <div className="col-span-full flex flex-wrap gap-2">
          {NATIVE_LOCALES.map((locale) => {
            const active = !customLanguage && language === locale.code;
            const suggested = suggestedLanguages.has(locale.code);
            return (
              <button
                key={locale.code}
                type="button"
                onClick={() => {
                  setCustomLanguage(false);
                  setLanguage(locale.code);
                }}
                aria-pressed={active}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active
                    ? 'border-primary/40 bg-accent font-medium'
                    : 'border-input bg-background hover:bg-accent/40'
                )}
              >
                <span dir={locale.direction}>{locale.endonym}</span>
                {suggested && !active && (
                  <span className="ms-2 text-xs text-muted-foreground">
                    {labels.languageSuggested}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setCustomLanguage(true);
              setLanguage('');
            }}
            aria-pressed={customLanguage}
            className={cn(
              'rounded-md border px-3 py-2 text-sm transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              customLanguage
                ? 'border-primary/40 bg-accent font-medium'
                : 'border-input bg-background hover:bg-accent/40'
            )}
          >
            {labels.languageOther}
          </button>
        </div>

        {customLanguage && (
          <input
            type="text"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            autoFocus
            placeholder={labels.languageOtherPlaceholder}
            aria-label={labels.languageOther}
            className={cn(inputClass, 'col-span-full')}
          />
        )}
      </CheckboxGroup>

      {/* Exactly one element ever carries this name — two would make
          FormData.get() read the first and silently drop the other. */}
      <input type="hidden" name="targetLanguage" value={language.trim()} />

      <input type="hidden" name="organizationId" value={organizationId} />

      <Button
        type="submit"
        size="lg"
        disabled={!!fileIssue || selectedFrameworks.size === 0 || language.trim().length < 2}
        className="w-full sm:w-auto"
      >
        {labels.submit}
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Running card — rotates phase strings purely client-side.           */
/* ------------------------------------------------------------------ */

function RunningCard({ progress, labels }: { progress: number; labels: AuditFormLabels }) {
  const phases = labels.processing.phases;

  // Map server-driven progress to the rotating phrase index. Each
  // phase string covers an equal slice of the 0-100 range, so the
  // visible phrase tracks real backend stages instead of a free-
  // running client timer. With 6 phases: 0-16 = phrase 0,
  // 17-33 = phrase 1, ..., 83-100 = phrase 5.
  const idx = phases.length > 0
    ? Math.min(phases.length - 1, Math.floor((progress / 100) * phases.length))
    : 0;
  const subPhase = phases[idx] ?? '';

  // Smooth out the bar. The server emits discrete jumps (10 → 35 → 85),
  // which feels janky as the bar leaps. We hold a `displayed` value
  // that creeps continuously toward the target between events: when a
  // new server event raises the target by N points, we animate over
  // ~1.2s. The CSS `transition: width` does the heavy lifting; the
  // useEffect just owns when to commit the new target.
  const [displayed, setDisplayed] = useState(5);
  useEffect(() => {
    const target = Math.max(5, Math.min(100, progress));
    // Defer one frame so the CSS transition fires (start === end skips it).
    const t = setTimeout(() => setDisplayed(target), 16);
    return () => clearTimeout(t);
  }, [progress]);

  return (
    <div className="grid gap-4 rounded-lg border bg-muted/30 p-6">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        <div className="font-medium">{labels.processing.running}</div>
      </div>
      <div
        key={idx}
        className="text-sm text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500"
        aria-live="polite"
      >
        {subPhase}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-foreground"
          style={{
            width: `${displayed}%`,
            // 1.2s ease-out covers the worst-case 35→85 server jump in
            // a single smooth sweep that never feels frozen and never
            // overshoots. Synchronised with the phase-text crossfade
            // so the whole card moves as one unit between stages.
            transition: 'width 1200ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayed)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Failed card — structured server error + retry CTA.                 */
/* ------------------------------------------------------------------ */

function FailedCard({ message, labels }: { message: string; labels: AuditFormLabels }) {
  // `message` is the server error code (e.g. "anthropic_error",
  // "no_credits"). Look it up in the localized errors map so the
  // user reads a human sentence in their language. Fall back to the
  // generic message if the code is unknown.
  const friendly =
    labels.errors[message] ?? labels.errors.generic ?? labels.failed.title;
  return (
    <div className="grid gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center gap-3">
        <XCircle className="h-5 w-5 text-destructive" aria-hidden />
        <div className="font-medium">{labels.failed.title}</div>
      </div>
      <p className="text-sm text-muted-foreground break-words">{friendly}</p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {labels.failed.tryAgain}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form field helper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Framework names carry their full statute reference — "Qatar PDPPL
 * (Personal Data Privacy Protection Law - Law No. 13 of 2016)". The
 * short form is what someone scans for; the statute is what they check
 * before trusting the result. Split so both can be shown at their own
 * weight instead of truncated into one line, which is what the old
 * select did. Names without a parenthetical (e.g. "UK GDPR + Data
 * Protection Act 2018") pass through whole.
 */
function splitFrameworkName(name: string): { short: string; detail?: string } {
  const open = name.indexOf(' (');
  if (open === -1 || !name.endsWith(')')) return { short: name };
  return { short: name.slice(0, open), detail: name.slice(open + 2, -1) };
}

/**
 * Label + hint wrapper for a set of related controls.
 *
 * Deliberately a `div[role="group"]` rather than `Field`, whose <label>
 * wraps its children: a label may only name one control, so wrapping a
 * checkbox list in it makes clicking the group title toggle the first
 * box. `aria-labelledby` gives the group its name without <legend>'s
 * layout quirks inside a flex row.
 */
function CheckboxGroup({
  legend,
  hint,
  meta,
  children
}: {
  legend: string;
  hint?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  // Generated, not hardcoded: the form renders this wrapper more than
  // once, and a duplicated id would point every group's aria-labelledby
  // at the first label on the page.
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-sm font-medium">
          {legend}
        </span>
        {meta && (
          <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>
        )}
      </div>
      <div role="group" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
        {children}
      </div>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

