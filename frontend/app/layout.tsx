import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LEGA.PT — Machines TP & Véhicules',
  description: 'LEGA.PT — Achat, vente de machines de travaux publics, camions et semi-remorques au Portugal et en Europe.',
  keywords: 'excavatrice, pelleteuse, camion, semi-remorque, machines TP, Portugal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style={{
        margin: 0,
        padding: 0,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        background: '#f8fafc',
        color: '#1e293b',
      }}>
        {children}
      </body>
    </html>
  );
}
