'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Run one scheduled job now, as the signed-in admin.
 *
 * The result is printed verbatim rather than summarised. These jobs
 * report per-source failures inside a successful response — a feed that
 * has moved answers `ok:false, error:"http_404"` next to three that
 * worked — and a green tick over that would hide exactly what the
 * operator opened the page to find out.
 */
export function CronRunButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(path, { method: 'POST', cache: 'no-store' });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON — an HTML error page, most likely. Showing it raw
        // beats showing "failed".
      }
      setResult(`HTTP ${res.status}\n${pretty}`);
    } catch (err) {
      setResult(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={run}>
          {busy ? 'Running…' : label}
        </Button>
        <code className="text-xs text-muted-foreground">{path}</code>
      </div>
      {result ? (
        <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
          {result}
        </pre>
      ) : null}
    </div>
  );
}
