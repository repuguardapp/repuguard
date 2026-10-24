import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: { default: 'RepuGuard', template: '%s — RepuGuard' },
  description: 'Gérez et améliorez votre réputation en ligne sur toutes les plateformes.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
