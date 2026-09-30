import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSM',
  description: 'Scan resi tulisan tangan menjadi baris Excel container.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
