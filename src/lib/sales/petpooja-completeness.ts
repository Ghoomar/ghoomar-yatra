import { getTodayBusinessDate } from '@/lib/utils';

/**
 * Authoritative Canonical List of the 3 Petpooja Daily Sales Report Types.
 * HOURLY_ITEM_SALES has been streamlined out (derived on-the-fly from ITEM_ORDER_DETAILS).
 * MENU_MASTER is master configuration data and is NOT part of daily sales completeness.
 */
export const REQUIRED_PETPOOJA_DAILY_REPORTS = [
  'ITEM_ORDER_DETAILS',
  'ORDERS_MASTER',
  'EXECUTIVE_SUMMARY',
] as const;

export type PetpoojaDailyReportType = (typeof REQUIRED_PETPOOJA_DAILY_REPORTS)[number];
export type DailyReportTypeKey = PetpoojaDailyReportType;

export type PetpoojaDayStatus = 'uploaded' | 'dueToday' | 'overdue' | 'upcoming';
export type PetpoojaReportItemStatus = 'imported' | 'pending' | 'future';
export type ReportStatus = PetpoojaReportItemStatus;

export interface PetpoojaReportConfigItem {
  key: PetpoojaDailyReportType;
  labelKey: string;
  fullTitleKey: string;
}

export const DAILY_REPORT_CONFIG: readonly PetpoojaReportConfigItem[] = [
  {
    key: 'ITEM_ORDER_DETAILS',
    labelKey: 'shortReportLabels.details',
    fullTitleKey: 'reportTypes.itemOrderDetails',
  },
  {
    key: 'ORDERS_MASTER',
    labelKey: 'shortReportLabels.orders',
    fullTitleKey: 'reportTypes.ordersMaster',
  },
  {
    key: 'EXECUTIVE_SUMMARY',
    labelKey: 'shortReportLabels.executive',
    fullTitleKey: 'reportTypes.executiveSummary',
  },
] as const;

export function getPetpoojaReportFullTitleKey(key: PetpoojaDailyReportType): string {
  const cfg = DAILY_REPORT_CONFIG.find((c) => c.key === key);
  return cfg ? `finance.sales.import.${cfg.fullTitleKey}` : key;
}

export function getPetpoojaReportShortLabelKey(key: PetpoojaDailyReportType): string {
  const cfg = DAILY_REPORT_CONFIG.find((c) => c.key === key);
  return cfg ? `finance.sales.import.${cfg.labelKey}` : key;
}

export interface PetpoojaReportItemEvaluation {
  key: PetpoojaDailyReportType;
  isImported: boolean;
  status: PetpoojaReportItemStatus;
}

export interface PetpoojaDayEvaluation {
  /** The Petpooja business/report date D (format: YYYY-MM-DD) */
  reportDate: string;
  /** The upload due date D + 1 (format: YYYY-MM-DD) */
  dueDate: string;
  /** The reference evaluation date, defaults to today's business date */
  referenceDate: string;
  /** Total daily reports required for completeness (always 4) */
  requiredCount: 4;
  /** Count of distinct required daily reports present (0 to 4) */
  importedCount: number;
  /** Whether all 4 required daily reports are present */
  isComplete: boolean;
  /** Whether the report date is in the future relative to the reference date */
  isFuture: boolean;
  /** Whether the reference date is before the upload due date (not yet due) */
  isBeforeDue: boolean;
  /** Whether the reference date is exactly the upload due date (D + 1) */
  isDueToday: boolean;
  /** Whether the report has become due (referenceDate >= dueDate while incomplete) */
  isDue: boolean;
  /** Whether the report is overdue (referenceDate > dueDate while incomplete) */
  isOverdue: boolean;
  /** Missing required report types */
  missingReportTypes: PetpoojaDailyReportType[];
  /** Present required report types */
  presentReportTypes: PetpoojaDailyReportType[];
  /** Overall daily completeness status: uploaded | dueToday | overdue | upcoming */
  status: PetpoojaDayStatus;
  /** Individual report item evaluations */
  reports: Record<PetpoojaDailyReportType, PetpoojaReportItemEvaluation>;
}

/**
 * Calculates due date for a Petpooja report date D (due on D + 1).
 */
export function getPetpoojaDueDate(reportDate: string): string {
  const [y, m, d] = reportDate.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m - 1, d + 1));
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts an operational business date O to its corresponding Petpooja report date (O - 1).
 */
export function getPreviousPetpoojaReportDate(operationalDate: string): string {
  const [y, m, d] = operationalDate.split('-').map(Number);
  const dObj = new Date(Date.UTC(y, m - 1, d - 1));
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Single Authoritative Business Rule Helper for evaluating Petpooja daily report completeness.
 *
 * @param reportDate The Petpooja business/report date D (e.g. '2026-09-30')
 * @param importedReportTypes Iterable of report types imported for reportDate
 * @param referenceDate The reference date (e.g. current business date), defaults to getTodayBusinessDate()
 */
export function evaluatePetpoojaReportStatus(
  reportDate: string,
  importedReportTypes: Iterable<string>,
  referenceDate: string = getTodayBusinessDate()
): PetpoojaDayEvaluation {
  const dueDate = getPetpoojaDueDate(reportDate);
  const isFuture = reportDate > referenceDate;

  const importedSet = new Set(importedReportTypes);
  const presentReportTypes: PetpoojaDailyReportType[] = [];
  const missingReportTypes: PetpoojaDailyReportType[] = [];
  const reportsRecord = {} as Record<PetpoojaDailyReportType, PetpoojaReportItemEvaluation>;

  REQUIRED_PETPOOJA_DAILY_REPORTS.forEach((typeKey) => {
    const isImported = importedSet.has(typeKey);
    if (isImported) {
      presentReportTypes.push(typeKey);
    } else {
      missingReportTypes.push(typeKey);
    }

    let itemStatus: PetpoojaReportItemStatus = 'pending';
    if (isFuture) {
      itemStatus = 'future';
    } else if (isImported) {
      itemStatus = 'imported';
    } else {
      itemStatus = 'pending';
    }

    reportsRecord[typeKey] = {
      key: typeKey,
      isImported,
      status: itemStatus,
    };
  });

  const importedCount = presentReportTypes.length;
  const isComplete = importedCount === REQUIRED_PETPOOJA_DAILY_REPORTS.length;

  const isDueToday = !isFuture && !isComplete && referenceDate === dueDate;
  const isBeforeDue = !isComplete && referenceDate < dueDate;
  const isOverdue = !isFuture && !isComplete && referenceDate > dueDate;
  const isDue = isDueToday || isOverdue;

  let status: PetpoojaDayStatus = 'upcoming';
  if (isComplete) {
    status = 'uploaded';
  } else if (isFuture || isBeforeDue) {
    status = 'upcoming';
  } else if (isDueToday) {
    status = 'dueToday';
  } else {
    // isOverdue
    status = 'overdue';
  }

  return {
    reportDate,
    dueDate,
    referenceDate,
    requiredCount: 4,
    importedCount,
    isComplete,
    isFuture,
    isBeforeDue,
    isDueToday,
    isDue,
    isOverdue,
    missingReportTypes,
    presentReportTypes,
    status,
    reports: reportsRecord,
  };
}
