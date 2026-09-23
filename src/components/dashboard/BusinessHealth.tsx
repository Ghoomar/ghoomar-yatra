'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n/context';

interface BusinessHealthProps {
  salesHealth: 'Healthy' | 'Warning' | 'Pending';
  footfallHealth: 'Healthy' | 'Warning';
  inventoryHealth: 'Healthy' | 'Warning';
  attendanceHealth: 'Healthy' | 'Warning';
  cashHealth: 'Healthy' | 'Warning';
  profitabilityHealth: 'Healthy' | 'Warning' | 'At Risk' | 'Below Break-Even' | 'ON TARGET' | 'BELOW TARGET' | 'NOT REPORTED' | string;
}

export function BusinessHealth({
  salesHealth,
  footfallHealth,
  inventoryHealth,
  attendanceHealth,
  cashHealth,
  profitabilityHealth,
}: BusinessHealthProps) {
  const { t } = useI18n();

  const getLocalizedHealthStatus = (s: string) => {
    const norm = (s || '').toUpperCase();
    switch (norm) {
      case 'HEALTHY':
        return t('dashboard.health.statusHealthy');
      case 'WARNING':
        return t('dashboard.health.statusWarning');
      case 'PENDING':
        return t('dashboard.health.statusPending');
      case 'ON TARGET':
        return t('dashboard.health.statusOnTarget');
      case 'AT RISK':
        return t('dashboard.health.statusAtRisk');
      case 'BELOW TARGET':
        return t('dashboard.health.statusBelowTarget');
      case 'BELOW BREAK-EVEN':
        return t('dashboard.health.statusBelowBreakEven');
      case 'NOT REPORTED':
        return t('dashboard.health.statusNotReported');
      default:
        return s;
    }
  };

  const healthItems = [
    { label: t('dashboard.health.salesPos'), status: salesHealth },
    { label: t('dashboard.health.footfallFlow'), status: footfallHealth },
    { label: t('dashboard.health.storeInventory'), status: inventoryHealth },
    { label: t('dashboard.health.staffAttendance'), status: attendanceHealth },
    { label: t('dashboard.health.cashGateway'), status: cashHealth },
    { label: t('dashboard.health.profitabilityPace'), status: profitabilityHealth },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('dashboard.health.systemStatus')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
          {healthItems.map((item, idx) => {
            const isGood = item.status === 'Healthy' || item.status === 'HEALTHY' || item.status === 'ON TARGET';
            const isWarn = item.status === 'Warning' || item.status === 'Pending' || item.status === 'At Risk' || item.status === 'AT RISK' || item.status === 'BELOW TARGET';
            const isDanger = item.status === 'Below Break-Even' || item.status === 'BELOW BREAK-EVEN';
            return (
              <div
                key={idx}
                className="p-2.5 rounded-lg border border-stone-200/70 bg-stone-50/70 flex items-center justify-between"
              >
                <span className="font-medium text-stone-700">{item.label}</span>
                <Badge variant={isGood ? 'success' : isWarn ? 'warning' : 'danger'}>
                  {getLocalizedHealthStatus(item.status)}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
