'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/context';

export interface ActionFlag {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  linkText: string;
  href: string;
}

export function ActionRequiredFlags({ flags }: { flags: ActionFlag[] }) {
  const { t } = useI18n();

  if (flags.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>{t('dashboard.actionFlags.alertsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-2 text-xs text-stone-500 py-6 text-center">
          {t('dashboard.actionFlags.smoothOperation')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{t('dashboard.actionFlags.alertsTitle')}</CardTitle>
          <Badge variant="danger">{t('dashboard.actionFlags.attentionItems', { count: flags.length })}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-2 text-xs">
        {flags.map((flag) => (
          <div
            key={flag.id}
            className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${
              flag.severity === 'critical'
                ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                : flag.severity === 'warning'
                ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                : 'bg-sky-50/70 border-sky-200 text-sky-950'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {flag.severity === 'critical' ? (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              ) : flag.severity === 'warning' ? (
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-bold">{flag.title}</div>
                <div className="text-[11px] opacity-90 mt-0.5">{flag.description}</div>
              </div>
            </div>

            <Link
              href={flag.href}
              className="inline-flex items-center gap-1 font-semibold text-[11px] underline underline-offset-2 shrink-0 hover:opacity-80"
            >
              <span>{flag.linkText}</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
