import type { Metadata } from 'next';
import {getServerTranslator} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
 const t=await getServerTranslator();
 return {
  title: t('marketing.gateTitle'),
  description: t('marketing.gateDescription'),
  manifest: '/manifest-gate.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: t('gate.title'),
  },
 };
}

export default function GateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
