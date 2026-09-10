'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { createClient } from '@/lib/supabase/client';
import { formatINR } from '@/lib/utils';
import { ItemModal } from '@/components/inventory/ItemModal';
import { UnitModal } from '@/components/admin/UnitModal';
import {
  Package,
  ArrowRightLeft,
  RefreshCw,
  AlertTriangle,
  ClipboardList,
  Plus,
  Scale,
  Edit2,
  Power,
  ShoppingBag,
  Search,
} from 'lucide-react';

function getMovementBadge(type: string) {
  switch (type) {
    case 'count_adjustment':
      return (
        <Badge variant="warning" className="gap-1 font-mono text-[10px]">
          <Scale className="h-3 w-3" /> Count Adjustment
        </Badge>
      );
    case 'purchase':
      return (
        <Badge variant="success" className="gap-1 font-mono text-[10px]">
          <ShoppingBag className="h-3 w-3" /> Purchase Inward
        </Badge>
      );
    case 'consumption_issue':
      return (
        <Badge variant="danger" className="gap-1 font-mono text-[10px]">
          <ArrowRightLeft className="h-3 w-3" /> Kitchen Issue
        </Badge>
      );
    case 'opening':
      return <Badge variant="outline" className="gap-1 font-mono text-[10px]">Opening Balance</Badge>;
    case 'wastage':
      return <Badge variant="danger" className="gap-1 font-mono text-[10px]">Wastage / Scrap</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
  }
}

function InventoryContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'catalog' | 'movements'>(
    tabParam === 'movements' ? 'movements' : 'catalog'
  );

  useEffect(() => {
    if (tabParam === 'movements') {
      setActiveTab('movements');
    } else if (tabParam === 'catalog') {
      setActiveTab('catalog');
    }
  }, [tabParam]);

  // Catalog State
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [search, setSearch] = useState('');

  // Movements State
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>(
    tabParam === 'movements' ? 'count_adjustment' : 'ALL'
  );
  const [movementItemFilter, setMovementItemFilter] = useState<string>('ALL');
  const [movementSearch, setMovementSearch] = useState('');

  // Modals
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [unitModalOpen, setUnitModalOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory_current_position')
        .select('*')
        .order('name');

      if (error) throw error;
      setItems(data || []);
    } catch (err: any) {
      console.error('Error loading inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMovements = async () => {
    setMovementsLoading(true);
    try {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('*, item:inventory_items(id, name, item_code, unit:units!inventory_items_unit_id_fkey(symbol, name))')
        .order('business_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMovements(data || []);
    } catch (err: any) {
      console.error('Error loading stock movements:', err);
    } finally {
      setMovementsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadMovements();
  }, []);

  const handleToggleStatus = async (item: any) => {
    const current = item.is_active !== false;
    const next = !current;
    try {
      const { error } = await supabase
        .from('inventory_items')
        .update({ is_active: next, updated_at: new Date().toISOString() })
        .eq('id', item.item_id);
      if (error) throw error;
      loadData();
    } catch (err: any) {
      alert('Failed to update status: ' + err.message);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesClass = filterClass === 'ALL' || item.inventory_class === filterClass;
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && item.is_active !== false) ||
        (statusFilter === 'INACTIVE' && item.is_active === false);
      const matchesSearch =
        !search ||
        item.name?.toLowerCase().includes(search.toLowerCase()) ||
        item.item_code?.toLowerCase().includes(search.toLowerCase());
      return matchesClass && matchesStatus && matchesSearch;
    });
  }, [items, filterClass, statusFilter, search]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (movementTypeFilter !== 'ALL' && m.movement_type !== movementTypeFilter) {
        return false;
      }
      if (movementItemFilter !== 'ALL' && m.item_id !== movementItemFilter) {
        return false;
      }
      if (movementSearch.trim()) {
        const q = movementSearch.toLowerCase();
        const itemName = m.item?.name?.toLowerCase() || '';
        const itemCode = m.item?.item_code?.toLowerCase() || '';
        const purpose = m.purpose?.toLowerCase() || '';
        const notes = m.notes?.toLowerCase() || '';
        if (!itemName.includes(q) && !itemCode.includes(q) && !purpose.includes(q) && !notes.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [movements, movementTypeFilter, movementItemFilter, movementSearch]);

  const totalStockValue = items.reduce((acc, i) => acc + (Number(i.current_stock_value) || 0), 0);
  const lowStockCount = items.filter(
    (i) => Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0 && i.is_active !== false
  ).length;
  const activeCount = items.filter((i) => i.is_active !== false).length;
  const inactiveCount = items.filter((i) => i.is_active === false).length;

  const totalAdjustments = movements.filter((m) => m.movement_type === 'count_adjustment');
  const netAdjustmentValue = totalAdjustments.reduce(
    (sum, m) => sum + (Number(m.quantity) < 0 ? -Number(m.total_value) : Number(m.total_value)),
    0
  );
  const totalPurchasesLogged = movements.filter((m) => m.movement_type === 'purchase');
  const totalPurchasesValue = totalPurchasesLogged.reduce((sum, m) => sum + Number(m.total_value || 0), 0);
  const totalIssuesLogged = movements.filter((m) => m.movement_type === 'consumption_issue');
  const totalIssuesValue = totalIssuesLogged.reduce((sum, m) => sum + Number(m.total_value || 0), 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-amber-600" />
            Inventory Stock &amp; Movement Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Central store SKU master catalog, authoritative stock movements, and real-time WAC valuation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditingItem(null);
              setItemModalOpen(true);
            }}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Plus className="h-4 w-4" /> Add SKU
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setUnitModalOpen(true)}
            className="gap-1.5"
          >
            <Scale className="h-4 w-4 text-stone-500" /> Units
          </Button>

          <Link href="/inventory/issues">
            <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
              <ArrowRightLeft className="h-4 w-4 text-amber-600" /> Issue to Kitchen
            </Button>
          </Link>

          <Link href="/inventory/count">
            <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
              <ClipboardList className="h-4 w-4 text-stone-500" /> Stock Audit
            </Button>
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadData();
              loadMovements();
            }}
            title="Refresh catalog and movements"
          >
            <RefreshCw className={`h-4 w-4 text-stone-600 ${loading || movementsLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="flex border-b border-stone-200 bg-white rounded-t-xl px-2">
        <button
          onClick={() => {
            setActiveTab('catalog');
            router.push('/inventory?tab=catalog');
          }}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'catalog'
              ? 'border-amber-600 text-amber-700 bg-amber-50/50'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <Package className="h-4 w-4" />
          Store Catalog &amp; Positions ({items.length})
        </button>

        <button
          onClick={() => {
            setActiveTab('movements');
            router.push('/inventory?tab=movements');
          }}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'movements'
              ? 'border-amber-600 text-amber-700 bg-amber-50/50'
              : 'border-transparent text-stone-500 hover:text-stone-800'
          }`}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Stock Movement Ledger ({movements.length})
        </button>
      </div>

      {activeTab === 'catalog' ? (
        <>
          {/* Catalog KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Total Central Store Valuation</CardDescription>
                <div className="text-2xl font-bold text-stone-900 mt-1">{formatINR(totalStockValue)}</div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Weighted Average Cost (WAC) × Derived Ledger Quantity
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Low Stock Alerts</CardDescription>
                <div className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {lowStockCount} Active Items Below Minimum
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Requires replenishment purchase orders
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Catalog Master Status</CardDescription>
                <div className="text-xl font-bold text-stone-800 mt-1">
                  {activeCount} <span className="text-xs font-normal text-emerald-600">Active</span>
                  {inactiveCount > 0 && (
                    <> / {inactiveCount} <span className="text-xs font-normal text-stone-400">Inactive</span></>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Authoritative Movement Ledger (Opening + Purchases − Issues)
              </CardContent>
            </Card>
          </div>

          {/* Catalog Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 border border-stone-200 rounded-xl text-xs shadow-xs">
            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              {['ALL', 'Food Raw Material', 'Non-Food Consumable', 'Physical Asset', 'Uniform'].map((cls) => (
                <button
                  key={cls}
                  onClick={() => setFilterClass(cls)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                    filterClass === cls
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              {/* Status Filter */}
              <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg border border-stone-200 shrink-0">
                {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                      statusFilter === st
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search SKU name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-64 rounded-lg border border-stone-300 p-2 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Stock Catalog Table */}
          <Card>
            <CardHeader>
              <CardTitle>Catalog Items ({filteredItems.length})</CardTitle>
              <CardDescription>Authoritative derived quantities, units, and real-time weighted average cost</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading central inventory...
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="py-12 text-center text-stone-400 text-xs">No inventory items found matching criteria.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">SKU Code</th>
                        <th className="py-2.5 px-3">Item Name</th>
                        <th className="py-2.5 px-3">Category / Class</th>
                        <th className="py-2.5 px-3 text-right">Current Quantity</th>
                        <th className="py-2.5 px-3 text-right">Min Stock</th>
                        <th className="py-2.5 px-3 text-right">WAC Rate (₹)</th>
                        <th className="py-2.5 px-3 text-right">Total Value</th>
                        <th className="py-2.5 px-3 text-center">Stock Status</th>
                        <th className="py-2.5 px-3 text-center">Lifecycle</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredItems.map((i) => {
                        const isLow = Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0;
                        const isActive = i.is_active !== false;

                        return (
                          <tr
                            key={i.item_id}
                            className={`hover:bg-stone-50/80 transition-colors ${
                              !isActive ? 'opacity-60 bg-stone-50/30' : ''
                            }`}
                          >
                            <td className="py-3 px-3 font-mono text-stone-500 font-medium">{i.item_code}</td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-stone-900">{i.name}</div>
                              {i.storage_area && (
                                <div className="text-[10px] text-stone-400">Area: {i.storage_area}</div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-stone-600">
                              {i.category_name || 'General'} <span className="text-stone-400">({i.inventory_class})</span>
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-sm text-stone-900">
                              {Number(i.current_quantity || 0).toFixed(2)}{' '}
                              <span className="text-xs font-normal text-stone-500">{i.unit_symbol || 'units'}</span>
                            </td>
                            <td className="py-3 px-3 text-right text-stone-500 font-mono">
                              {Number(i.minimum_stock || 0).toFixed(1)}
                            </td>
                            <td className="py-3 px-3 text-right text-stone-800 font-medium">
                              {formatINR(Number(i.wac_cost || 0))}
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-stone-900">
                              {formatINR(Number(i.current_stock_value || 0))}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {isLow ? (
                                <Badge variant="danger" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Low Stock
                                </Badge>
                              ) : (
                                <Badge variant="success">Sufficient</Badge>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {isActive ? (
                                <Badge variant="success">Active</Badge>
                              ) : (
                                <Badge variant="outline">Inactive</Badge>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingItem(i);
                                    setItemModalOpen(true);
                                  }}
                                  className="h-7 px-2 text-stone-600 hover:text-stone-900"
                                  title="Edit SKU"
                                >
                                  <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleToggleStatus(i)}
                                  className={`h-7 px-2 ${
                                    isActive
                                      ? 'text-rose-600 hover:text-rose-700 hover:bg-rose-50'
                                      : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
                                  }`}
                                  title={isActive ? 'Deactivate SKU' : 'Activate SKU'}
                                >
                                  <Power className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Movement Ledger KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Logged Stock Movements</CardDescription>
                <div className="text-2xl font-bold text-stone-900 mt-1">{movements.length}</div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Authoritative movement transactions
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Physical Count Adjustments</CardDescription>
                <div className="text-2xl font-bold text-amber-700 mt-1">
                  {totalAdjustments.length} <span className="text-xs font-normal text-stone-500">postings</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Net Variance: {formatINR(netAdjustmentValue)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Procurement Inward Receipts</CardDescription>
                <div className="text-2xl font-bold text-emerald-700 mt-1">{formatINR(totalPurchasesValue)}</div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                {totalPurchasesLogged.length} inward movement transactions
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Departmental Issues</CardDescription>
                <div className="text-2xl font-bold text-rose-700 mt-1">{formatINR(totalIssuesValue)}</div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                {totalIssuesLogged.length} issues to kitchen &amp; stage
              </CardContent>
            </Card>
          </div>

          {/* Movement Filters */}
          <div className="space-y-3 bg-white p-3.5 border border-stone-200 rounded-xl text-xs shadow-xs">
            {/* Quick Movement Type Buttons */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-xs font-semibold text-stone-500 shrink-0 mr-1">Movement Type:</span>
              {[
                { id: 'ALL', label: 'All Movements' },
                { id: 'count_adjustment', label: 'Physical Count Adjustments' },
                { id: 'purchase', label: 'Purchases' },
                { id: 'consumption_issue', label: 'Store Issues' },
                { id: 'opening', label: 'Opening Balances' },
                { id: 'wastage', label: 'Wastage / Scrap' },
              ].map((mType) => (
                <button
                  key={mType.id}
                  onClick={() => setMovementTypeFilter(mType.id)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                    movementTypeFilter === mType.id
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                >
                  {mType.label}
                </button>
              ))}
            </div>

            {/* Filter Bar Row: Item & Search */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-stone-100">
              {/* Item Filter Dropdown */}
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <span className="text-stone-500 font-medium">Filter by SKU:</span>
                <select
                  value={movementItemFilter}
                  onChange={(e) => setMovementItemFilter(e.target.value)}
                  className="rounded-lg border border-stone-200 py-1.5 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white max-w-[220px] truncate"
                >
                  <option value="ALL">All Items</option>
                  {items.map((i) => (
                    <option key={i.item_id} value={i.item_id}>
                      {i.name} ({i.item_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Bar */}
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search by SKU code, name, purpose, or audit reason..."
                  value={movementSearch}
                  onChange={(e) => setMovementSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>

              {(movementTypeFilter !== 'ALL' || movementItemFilter !== 'ALL' || movementSearch.trim()) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMovementTypeFilter('ALL');
                    setMovementItemFilter('ALL');
                    setMovementSearch('');
                  }}
                  className="text-xs text-stone-500 hover:text-stone-800"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Movement Ledger Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-stone-100">
              <div>
                <CardTitle>Stock Movement Ledger ({filteredMovements.length})</CardTitle>
                <CardDescription>
                  Chronological transaction log of receipts, consumption issues, and physical count audit adjustments
                </CardDescription>
              </div>
              <Link href="/inventory/count">
                <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
                  <ClipboardList className="h-3.5 w-3.5 text-amber-600" /> New Physical Count Audit
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-0">
              {movementsLoading ? (
                <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading movement transactions...
                </div>
              ) : filteredMovements.length === 0 ? (
                <div className="py-12 text-center text-stone-500 text-xs">
                  No stock movements found matching your filter criteria.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-stone-200 text-stone-500 font-semibold bg-stone-50/50">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">SKU &amp; Item Name</th>
                        <th className="py-2.5 px-3 text-center">Movement Type</th>
                        <th className="py-2.5 px-3 text-right">Quantity</th>
                        <th className="py-2.5 px-3 text-right">Unit Rate (₹)</th>
                        <th className="py-2.5 px-3 text-right">Total Value</th>
                        <th className="py-2.5 px-3">Purpose &amp; Reason</th>
                        <th className="py-2.5 px-3">Notes / Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredMovements.map((m) => {
                        const qty = Number(m.quantity) || 0;
                        const unitSymbol = m.item?.unit?.symbol || 'units';

                        return (
                          <tr key={m.id} className="hover:bg-stone-50/80 transition-colors">
                            <td className="py-3 px-3 font-mono text-stone-600 whitespace-nowrap">
                              {m.business_date}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-stone-900">{m.item?.name || 'Unknown Item'}</div>
                              <div className="font-mono text-[10px] text-stone-400">{m.item?.item_code}</div>
                            </td>
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              {getMovementBadge(m.movement_type)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold whitespace-nowrap">
                              <span className={qty > 0 ? 'text-emerald-700' : qty < 0 ? 'text-rose-600' : 'text-stone-700'}>
                                {qty > 0 ? `+${qty.toFixed(2)}` : qty.toFixed(2)} {unitSymbol}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right text-stone-700 font-medium whitespace-nowrap">
                              {formatINR(Number(m.unit_cost) || 0)}
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-stone-900 whitespace-nowrap">
                              {formatINR(Number(m.total_value) || 0)}
                            </td>
                            <td className="py-3 px-3 text-stone-700 max-w-[200px]">
                              <div className="font-medium truncate">{m.purpose || '—'}</div>
                            </td>
                            <td className="py-3 px-3 text-stone-500 max-w-[220px]">
                              <div className="text-[11px] truncate" title={m.notes || ''}>
                                {m.notes || (m.reference_type ? `${m.reference_type}` : '—')}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Modals */}
      <ItemModal
        isOpen={itemModalOpen}
        onClose={() => {
          setItemModalOpen(false);
          setEditingItem(null);
        }}
        item={editingItem}
        onSaved={() => {
          setItemModalOpen(false);
          setEditingItem(null);
          loadData();
          loadMovements();
        }}
      />

      <UnitModal
        isOpen={unitModalOpen}
        onClose={() => setUnitModalOpen(false)}
        onUpdated={() => {
          loadData();
          loadMovements();
        }}
      />
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
          Loading central inventory...
        </div>
      }
    >
      <InventoryContent />
    </Suspense>
  );
}

