import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: '1MBrain Pulse Brain',
  description: 'Live memory graph dashboard for 1MBrain.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
