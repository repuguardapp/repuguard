'use client';

import { useState } from 'react';

interface FrameworkOption {
  id: string;
  name: string;
}

interface Labels {
  upload: string;
  uploadHint: string;
  targetLanguage: string;
  targetLanguageHint: string;
  framework: string;
  submit: string;
  running: string;
}

interface Props {
  labels: Labels;
  frameworks: FrameworkOption[];
  defaultLanguage: string;
}

/**
 * Audit form. Posts multipart/form-data to /api/audit so the file never
 * touches localStorage / sessionStorage / IndexedDB. The browser hands the
 * blob to the server and forgets about it.
 */
export function AuditForm({ labels, frameworks, defaultLanguage }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/audit', { method: 'POST', body: form });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error ?? 'audit_failed');
      }
      const { auditId } = await res.json();
      window.location.assign(`./audit/${auditId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <Field label={labels.upload} hint={labels.uploadHint}>
        <input
          type="file"
          name="document"
          required
          accept=".pdf,.docx,.md,.txt"
          className="block w-full text-sm"
        />
      </Field>

      <Field label={labels.framework}>
        <select
          name="frameworks"
          required
          multiple
          className="block w-full rounded-md border border-slate-300 px-3 py-2 min-h-[8rem]"
        >
          {frameworks.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={labels.targetLanguage} hint={labels.targetLanguageHint}>
        <input
          type="text"
          name="targetLanguage"
          required
          defaultValue={defaultLanguage}
          placeholder="en, fr, ja, ar, vi…"
          className="block w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </Field>

      {/* Hidden — comes from the auth/session in production. */}
      <input type="hidden" name="organizationId" value="00000000-0000-0000-0000-000000000000" />

      <button
        type="submit"
        disabled={submitting}
        className="btn inline-flex items-center justify-center rounded-md bg-brand-500 text-white px-5 py-3 font-medium hover:bg-brand-900 disabled:opacity-60"
      >
        {submitting ? labels.running : labels.submit}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
