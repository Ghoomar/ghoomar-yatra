'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatINR } from '@/lib/utils';
import { SalesImportBatch } from '@/lib/types/sales';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  Check,
  X,
  History,
  FileText,
} from 'lucide-react';

interface SalesImportSectionProps {
  onImportSuccess?: () => void;
}

export function SalesImportSection({ onImportSuccess }: SalesImportSectionProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [duplicateModal, setDuplicateModal] = useState<{
    isOpen: boolean;
    message: string;
    existingBatch?: any;
  }>({ isOpen: false, message: '' });

  const [batches, setBatches] = useState<SalesImportBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBatches = async () => {
    setLoadingBatches(true);
    try {
      const res = await fetch('/api/finance/sales/import');
      const data = await res.json();
      if (res.ok) {
        setBatches(data.batches || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBatches(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, []);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selected = e.dataTransfer.files[0];
      setFile(selected);
      setMessage(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setMessage(null);
    }
  };

  const uploadFile = async (forceOverwrite = false) => {
    if (!file) return;
    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (forceOverwrite) {
        formData.append('overwrite', 'true');
      }

      const res = await fetch('/api/finance/sales/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.status === 409 && data.isDuplicate) {
        setDuplicateModal({
          isOpen: true,
          message: data.message,
          existingBatch: data.existingBatch,
        });
        setUploading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to import report.');
      }

      setMessage({
        type: 'success',
        text: data.message || `Successfully imported ${data.reportType} for ${data.businessDate}.`,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setDuplicateModal({ isOpen: false, message: '' });
      loadBatches();
      if (onImportSuccess) onImportSuccess();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error uploading file.' });
    } finally {
      setUploading(false);
    }
  };

  const formatReportTypeLabel = (type: string) => {
    switch (type) {
      case 'HOURLY_ITEM_SALES':
        return 'Hourly Item Sales';
      case 'ORDERS_MASTER':
        return 'Orders Master';
      case 'EXECUTIVE_SUMMARY':
        return 'Executive Summary';
      case 'MENU_MASTER':
        return 'Menu Master';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Dropzone Card */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-stone-900">
            Import Petpooja Reports
          </CardTitle>
          <CardDescription className="text-xs text-stone-500">
            Upload raw Petpooja Excel (.xlsx, .xls) or CSV files. The importer automatically detects report type, extracts dates, and checks for duplicates.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {message && (
            <div
              className={`p-3 rounded-xl text-xs font-medium flex items-center justify-between gap-2 ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {message.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                )}
                <span>{message.text}</span>
              </div>
              <button onClick={() => setMessage(null)} className="text-stone-400 hover:text-stone-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-stone-200 hover:border-amber-400 bg-stone-50/50 hover:bg-amber-50/20 rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <div className="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-2xs">
              <UploadCloud className="h-6 w-6" />
            </div>

            {file ? (
              <div className="space-y-1">
                <p className="text-sm font-bold text-stone-900 flex items-center justify-center gap-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-amber-600" />
                  {file.name}
                </p>
                <p className="text-xs text-stone-500 font-mono">
                  {(file.size / 1024).toFixed(1)} KB • Click or drop to replace
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-stone-800">
                  Drop Petpooja export file here, or <span className="text-amber-600 underline">browse</span>
                </p>
                <p className="text-xs text-stone-400">
                  Supports Hourly Item Sales, Orders Master, Executive Sales Summary, or Menu Export (.xlsx, .xls, .csv)
                </p>
              </div>
            )}
          </div>

          {/* Upload Button */}
          {file && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                disabled={uploading}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => uploadFile(false)}
                disabled={uploading}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Parsing &amp; Importing...
                  </>
                ) : (
                  'Import Report'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import History Table */}
      <Card className="border-stone-200 shadow-xs">
        <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-stone-100">
          <div>
            <CardTitle className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <History className="h-4 w-4 text-stone-500" />
              Import History ({batches.length})
            </CardTitle>
            <CardDescription className="text-xs text-stone-500">
              Audit log of previously uploaded Petpooja reports
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadBatches}
            disabled={loadingBatches}
            className="h-7 text-xs"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loadingBatches ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {loadingBatches ? (
            <div className="py-12 text-center text-xs text-stone-400">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2 text-amber-500" />
              Loading import history...
            </div>
          ) : batches.length === 0 ? (
            <div className="py-12 text-center text-xs text-stone-400">
              No reports imported yet. Upload your first Petpooja report above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-semibold">
                  <tr>
                    <th className="p-3">Report Date</th>
                    <th className="p-3">Report Type</th>
                    <th className="p-3">File Name</th>
                    <th className="p-3 text-center">Records</th>
                    <th className="p-3 text-right">Net Sales</th>
                    <th className="p-3 text-right">Imported At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {batches.map((b) => (
                    <tr key={b.id} className="hover:bg-stone-50/50">
                      <td className="p-3 font-semibold text-stone-900 whitespace-nowrap">
                        {b.business_date}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <Badge
                          variant={
                            b.report_type === 'EXECUTIVE_SUMMARY'
                              ? 'default'
                              : b.report_type === 'ORDERS_MASTER'
                              ? 'info'
                              : b.report_type === 'HOURLY_ITEM_SALES'
                              ? 'warning'
                              : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {formatReportTypeLabel(b.report_type)}
                        </Badge>
                      </td>
                      <td className="p-3 text-stone-600 font-mono text-[11px] truncate max-w-[200px]" title={b.file_name}>
                        {b.file_name}
                      </td>
                      <td className="p-3 text-center font-medium text-stone-700 whitespace-nowrap">
                        {b.record_count}
                      </td>
                      <td className="p-3 text-right font-bold text-stone-900 whitespace-nowrap">
                        {b.total_net_sales > 0 ? formatINR(b.total_net_sales) : '—'}
                      </td>
                      <td className="p-3 text-right text-stone-400 whitespace-nowrap">
                        {new Date(b.created_at).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Duplicate Warning Modal */}
      {duplicateModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-stone-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4 bg-amber-50/50">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-900">Duplicate Report Detected</h3>
                  <p className="text-xs text-stone-500">Report already exists for this date</p>
                </div>
              </div>
              <button
                onClick={() => setDuplicateModal({ isOpen: false, message: '' })}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-stone-600 leading-relaxed">
                {duplicateModal.message}
              </p>

              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs space-y-1">
                <span className="text-stone-400 block text-[10px] uppercase font-semibold">Existing Batch</span>
                <p className="font-semibold text-stone-900">{duplicateModal.existingBatch?.file_name}</p>
                <p className="text-stone-500">
                  Net Sales: {formatINR(duplicateModal.existingBatch?.total_net_sales)} • Imported: {new Date(duplicateModal.existingBatch?.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDuplicateModal({ isOpen: false, message: '' })}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => uploadFile(true)}
                  disabled={uploading}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {uploading ? 'Overwriting...' : 'Overwrite & Replace'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
