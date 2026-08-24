import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  applicationName: 'LexyFlow',
  authors: [{ name: 'LexyFlow', url: 'https://lexyflow.com' }],
  creator: 'LexyFlow',
  publisher: 'LexyFlow',
  formatDetection: { email: false, address: false, telephone: false },
  // Google Search Console site ownership proof. Next.js emits this as
  // <meta name="google-site-verification" content="…"> in the <head>
  // of every page — the mechanism GSC's "HTML tag" verification method
  // scans for on the domain root. Rendered from the root layout so the
  // tag survives every locale switch and every route.
  verification: {
    google: '_QQ_7V3zGMR8THx2UL_wNglPTDdxPpwRYX3KVMNgyJY'
  },
  openGraph: {
    type: 'website',
    siteName: 'LexyFlow'
  },
  twitter: {
    card: 'summary_large_image',
    site: '@lexyflow_ai'
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)',  color: '#0b0b0d' }
  ],
  width: 'device-width',
  initialScale: 1
};

/**
 * Root layout is intentionally minimal: per-locale layout owns `<html lang>`
 * and `<html dir>` so a single shell handles LTR + RTL without a remount.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
