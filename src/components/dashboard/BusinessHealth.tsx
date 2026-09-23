import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

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
  const healthItems = [
    { label: 'Sales & POS', status: salesHealth },
    { label: 'Footfall Flow', status: footfallHealth },
    { label: 'Store Inventory', status: inventoryHealth },
    { label: 'Staff Attendance', status: attendanceHealth },
    { label: 'Cash & Gateway', status: cashHealth },
    { label: 'Profitability Pace', status: profitabilityHealth },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>System Status</CardTitle>
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
                  {item.status}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
