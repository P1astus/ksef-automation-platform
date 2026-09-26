import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "KSeF Auto – Automatyzacja KSeF dla biur rachunkowych",
  description: "Platforma SaaS do automatycznego pobierania faktur z KSeF, generowania raportów JPK i zarządzania klientami dla biur rachunkowych.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce from middleware. Reading it also renders every page
  // dynamically, which a nonce requires (a prerendered page has no nonce).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="pl">
      <head>
        <link
          rel="preload"
          href="/fonts/plus-jakarta-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href="/fonts/plus-jakarta-sans.css" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="KSeF Auto" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
          }
        `}} />
      </head>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
