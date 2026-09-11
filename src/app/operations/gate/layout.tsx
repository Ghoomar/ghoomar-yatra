import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yatra Gate | Footfall Counter',
  description: 'Offline-First Fast Touch Counter for Ghoomar Yatra Highway Gate',
  manifest: '/manifest-gate.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Yatra Gate',
  },
};

export default function GateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
