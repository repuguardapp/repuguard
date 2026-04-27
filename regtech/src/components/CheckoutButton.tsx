'use client';

import { useState } from 'react';

interface Props {
  plan: 'starter' | 'pro' | 'enterprise';
  locale: string;
  label: string;
}

export function CheckoutButton({ plan, locale, label }: Props) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          locale,
          // Real value comes from auth context in production.
          organizationId: '00000000-0000-0000-0000-000000000000'
        })
      });
      const data = await res.json();
      if (data.url) window.location.assign(data.url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className="btn inline-flex items-center justify-center rounded-md bg-brand-500 text-white px-4 py-2 font-medium hover:bg-brand-900 disabled:opacity-60"
    >
      {label}
    </button>
  );
}
