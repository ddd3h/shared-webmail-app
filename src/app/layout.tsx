import './globals.css';
import type { ReactNode } from 'react';
import SWClient from './sw-client';

export const metadata = {
  title: '共有メールワークスペース',
  description: 'IMAP/SMTP ベースの共有メール運用システム',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '共有メール'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="共有メール" />
        {/* Safari uses apple-touch-icon, not manifest icons */}
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-screen bg-gray-50" suppressHydrationWarning>
        {children}
        <SWClient />
      </body>
    </html>
  );
}
