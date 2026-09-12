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
import { ItemMovementDrawer } from '@/components/inventory/ItemMovementDrawer';
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
  History,
  MapPin,
  Calendar,
  AlertCircle,
  Truck,
  Flame,
  UtensilsCrossed,
} from 'lucide-react';

function getMovementBadge(type: string) {
  switch (type) {
    case 'count_adjustment':
    case 'physical_count_adjustment':
      return (
        <Badge variant="warning" className="gap-1 font-mono text-[10px]">
          <Scale className="h-3 w-3" /> Count Audit
        </Badge>
      );
    case 'purchase':
      return (
        <Badge variant="success" className="gap-1 font-mono text-[10px]">
          <ShoppingBag className="h-3 w-3" /> Purchase Inward
        </Badge>
      );
    case 'transfer':
      return (
        <Badge variant="default" className="gap-1 font-mono text-[10px] bg-blue-100 text-blue-800 border-blue-200">
          <Truck className="h-3 w-3" /> Transfer
        </Badge>
      );
    case 'consumption_issue':
    case 'issue':
      return (
        <Badge variant="danger" className="gap-1 font-mono text-[10px]">
          <ArrowRightLeft className="h-3 w-3" /> Store Issue
        </Badge>
      );
    case 'sale':
      return (
        <Badge variant="success" className="gap-1 font-mono text-[10px] bg-emerald-100 text-emerald-800 border-emerald-200">
          <ShoppingBag className="h-3 w-3" /> Direct Sale
        </Badge>
      );
    case 'consumption':
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[10px] bg-purple-50 text-purple-700 border-purple-200">
          <Flame className="h-3 w-3" /> Consumed
        </Badge>
      );
    case 'staff_food':
      return (
        <Badge variant="outline" className="gap-1 font-mono text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">
          <UtensilsCrossed className="h-3 w-3" /> Staff Food
        </Badge>
      );
    case 'breakage':
      return (
        <Badge variant="danger" className="gap-1 font-mono text-[10px] bg-rose-100 text-rose-800 border-rose-200">
          <AlertTriangle className="h-3 w-3" /> Broken / Damaged
        </Badge>
      );
    case 'loss':
      return (
        <Badge variant="danger" className="gap-1 font-mono text-[10px] bg-amber-100 text-amber-800 border-amber-200">
          <AlertCircle className="h-3 w-3" /> Lost / Missing
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
  const [locations, setLocations] = useState<any[]>([]);
  const [locationStocks, setLocationStocks] = useState<any[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | 'EXPIRING_SOON'>('ALL');
  const [hideZeroStock, setHideZeroStock] = useState(false);
  const [search, setSearch] = useState('');

  // Movements State
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>(
    tabParam === 'movements' ? 'count_adjustment' : 'ALL'
  );
  const [movementItemFilter, setMovementItemFilter] = useState<string>('ALL');
  const [movementLocationFilter, setMovementLocationFilter] = useState<string>('ALL');
  const [movementSearch, setMovementSearch] = useState('');

  // Modals
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [selectedMovementItem, setSelectedMovementItem] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [posRes, locRes, stockRes] = await Promise.all([
        supabase.from('inventory_current_position').select('*').order('name'),
        supabase.from('inventory_locations').select('*').eq('is_active', true).order('code'),
        supabase.from('item_location_stocks').select('item_id, location_id, quantity, location:inventory_locations(id, name, code)'),
      ]);

      if (posRes.error) throw posRes.error;
      setItems(posRes.data || []);
      setLocations(locRes.data || []);
      setLocationStocks(stockRes.data || []);
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
        .select(`*, item:inventory_items(id, name, item_code, unit:units!inventory_items_unit_id_fkey(symbol, name)), source_location:inventory_locations!stock_movements_source_location_id_fkey(id, name, code), destination_location:inventory_locations!stock_movements_destination_location_id_fkey(id, name, code)`)
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

  // Map of item_id -> array of { location_id, location_name, location_code, quantity }
  const itemLocationStockMap = useMemo(() => {
    const map: Record<string, { location_id: string; location_name: string; location_code: string; quantity: number }[]> = {};
    locationStocks.forEach((s) => {
      if (!map[s.item_id]) map[s.item_id] = [];
      map[s.item_id].push({
        location_id: s.location_id,
        location_name: s.location?.name || 'Location',
        location_code: s.location?.code || '',
        quantity: Number(s.quantity) || 0,
      });
    });
    return map;
  }, [locationStocks]);

  // Lookup map: item_id -> { [location_id]: quantity }
  const itemLocQtyLookup = useMemo(() => {
    const lookup: Record<string, Record<string, number>> = {};
    locationStocks.forEach((s) => {
      if (!lookup[s.item_id]) lookup[s.item_id] = {};
      lookup[s.item_id][s.location_id] = Number(s.quantity) || 0;
    });
    return lookup;
  }, [locationStocks]);

  // Movement expiry lookup (earliest active expiry per item)
  const itemExpiryMap = useMemo(() => {
    const expMap: Record<string, { batch_number?: string; expiry_date: string; daysLeft: number }> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    movements.forEach((m) => {
      if (m.expiry_date) {
        const exp = new Date(m.expiry_date);
        const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (!expMap[m.item_id] || exp < new Date(expMap[m.item_id].expiry_date)) {
          expMap[m.item_id] = {
            batch_number: m.batch_number,
            expiry_date: m.expiry_date,
            daysLeft: diffDays,
          };
        }
      }
    });
    return expMap;
  }, [movements]);

  // Expiring items count (<= 30 days)
  const expiringItemsCount = useMemo(() => {
    return Object.values(itemExpiryMap).filter((e) => e.daysLeft <= 30).length;
  }, [itemExpiryMap]);

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

      // Expiry filter
      if (expiryFilter === 'EXPIRING_SOON') {
        const exp = itemExpiryMap[item.item_id];
        if (!exp || exp.daysLeft > 30) return false;
      }

      // Location filter
      if (selectedLocationId !== 'ALL') {
        const locQty = itemLocQtyLookup[item.item_id]?.[selectedLocationId] || 0;
        if (hideZeroStock && locQty <= 0) return false;
      }

      return matchesClass && matchesStatus && matchesSearch;
    });
  }, [items, filterClass, statusFilter, search, expiryFilter, selectedLocationId, hideZeroStock, itemLocQtyLookup, itemExpiryMap]);

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (movementTypeFilter !== 'ALL' && m.movement_type !== movementTypeFilter) {
        return false;
      }
      if (movementItemFilter !== 'ALL' && m.item_id !== movementItemFilter) {
        return false;
      }
      if (movementLocationFilter !== 'ALL') {
        if (m.source_location_id !== movementLocationFilter && m.destination_location_id !== movementLocationFilter) {
          return false;
        }
      }
      if (movementSearch.trim()) {
        const q = movementSearch.toLowerCase();
        const itemName = m.item?.name?.toLowerCase() || '';
        const itemCode = m.item?.item_code?.toLowerCase() || '';
        const purpose = m.purpose?.toLowerCase() || '';
        const notes = m.notes?.toLowerCase() || '';
        const batch = m.batch_number?.toLowerCase() || '';
        if (!itemName.includes(q) && !itemCode.includes(q) && !purpose.includes(q) && !notes.includes(q) && !batch.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [movements, movementTypeFilter, movementItemFilter, movementLocationFilter, movementSearch]);

  const totalStockValue = items.reduce((acc, i) => acc + (Number(i.current_stock_value) || 0), 0);
  const lowStockCount = items.filter(
    (i) => Number(i.current_quantity) <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0 && i.is_active !== false
  ).length;
  const activeCount = items.filter((i) => i.is_active !== false).length;
  const inactiveCount = items.filter((i) => i.is_active === false).length;

  const totalAdjustments = movements.filter((m) => m.movement_type === 'count_adjustment' || m.movement_type === 'physical_count_adjustment');
  const netAdjustmentValue = totalAdjustments.reduce(
    (sum, m) => sum + (Number(m.quantity) < 0 ? -Number(m.total_value) : Number(m.total_value)),
    0
  );
  const totalPurchasesLogged = movements.filter((m) => m.movement_type === 'purchase');
  const totalPurchasesValue = totalPurchasesLogged.reduce((sum, m) => sum + Number(m.total_value || 0), 0);
  const totalIssuesLogged = movements.filter((m) => m.movement_type === 'consumption_issue' || m.movement_type === 'issue');
  const totalIssuesValue = totalIssuesLogged.reduce((sum, m) => sum + Number(m.total_value || 0), 0);
  const totalTransfersLogged = movements.filter((m) => m.movement_type === 'transfer');

  const selectedLocationObj = locations.find((l) => l.id === selectedLocationId);

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Package className="h-6 w-6 text-amber-600" />
            Store Inventory &amp; Movement Ledger
          </h1>
          <p className="text-sm text-stone-500">
            Location-aware SKU catalog, inter-location transfers, authoritative ledger, and real-time WAC valuation.
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
              <ArrowRightLeft className="h-4 w-4 text-amber-600" /> Issues &amp; Transfers
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

      {/* Expiry Alert Banner */}
      {expiringItemsCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">{expiringItemsCount} item(s)</span> have batches expiring within the next 30 days or already expired!
              <span className="text-amber-700 ml-1">Practice First-Expiry-First-Out (FEFO) store management.</span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpiryFilter(expiryFilter === 'EXPIRING_SOON' ? 'ALL' : 'EXPIRING_SOON')}
            className="text-xs h-7 border-amber-300 text-amber-900 bg-white hover:bg-amber-100"
          >
            {expiryFilter === 'EXPIRING_SOON' ? 'Show All SKUs' : 'View Expiring Items'}
          </Button>
        </div>
      )}

      {/* Primary Tab Navigation */}
      <div className="overflow-x-auto scrollbar-none -mx-2 px-2 sm:mx-0 sm:px-0">
        <div className="flex border-b border-stone-200 bg-white rounded-t-xl min-w-max">
          <button
            onClick={() => {
              setActiveTab('catalog');
              router.push('/inventory?tab=catalog');
            }}
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
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
            className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'movements'
                ? 'border-amber-600 text-amber-700 bg-amber-50/50'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Stock Movement Ledger ({movements.length})
          </button>
        </div>
      </div>

      {activeTab === 'catalog' ? (
        <>
          {/* Catalog KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Total Stock Valuation</CardDescription>
                <div className="text-2xl font-bold text-stone-900 mt-1">{formatINR(totalStockValue)}</div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Weighted Average Cost (WAC) × Total System Stock
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Active Locations</CardDescription>
                <div className="text-2xl font-bold text-stone-900 mt-1 flex items-center gap-1.5">
                  <MapPin className="h-5 w-5 text-amber-600" />
                  {locations.length} Locations
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Store, fridges, beverage counters &amp; halls
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardDescription>Low Stock Alerts</CardDescription>
                <div className={`text-2xl font-bold mt-1 ${lowStockCount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {lowStockCount} Below Minimum
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
                Authoritative Movement Ledger (Open + Inward − Issues)
              </CardContent>
            </Card>
          </div>

          {/* Catalog Location Filter & Toolbar */}
          <div className="bg-white p-3.5 border border-stone-200 rounded-xl space-y-3 text-xs shadow-xs">
            {/* Top Row: Location Selector & Quick Filter Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Location Selector */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-stone-700 flex items-center gap-1.5 shrink-0">
                  <MapPin className="h-4 w-4 text-amber-600" /> Physical Location:
                </span>
                <select
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  className="font-semibold text-xs rounded-lg border border-stone-300 py-1.5 px-3 bg-stone-50 text-stone-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                >
                  <option value="ALL">🏢 All Locations (Total System Stock)</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      📍 {loc.name} ({loc.code})
                    </option>
                  ))}
                </select>

                {selectedLocationId !== 'ALL' && (
                  <label className="flex items-center gap-1.5 text-stone-600 text-[11px] ml-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideZeroStock}
                      onChange={(e) => setHideZeroStock(e.target.checked)}
                      className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                    />
                    Hide items with 0 stock here
                  </label>
                )}
              </div>

              {/* Status Filter Toggle */}
              <div className="flex items-center gap-2">
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

                {expiryFilter === 'EXPIRING_SOON' && (
                  <Badge variant="warning" className="gap-1 text-[10px]">
                    <Calendar className="h-3 w-3" /> Expiring Soon Active
                  </Badge>
                )}
              </div>
            </div>

            {/* Bottom Row: Category Class Pills & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-stone-100">
              <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
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

              <div className="relative flex-1 w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search SKU name or code..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-200 text-stone-900 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Stock Catalog Table */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle>
                    Catalog Items ({filteredItems.length})
                    {selectedLocationObj && (
                      <span className="ml-2 text-xs font-normal text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                        Location: {selectedLocationObj.name}
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {selectedLocationId === 'ALL'
                      ? 'Total system quantities, location allocations, and weighted average cost'
                      : `Quantities and status physically located at ${selectedLocationObj?.name}`}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="py-12 text-center text-stone-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-600" /> Loading inventory data...
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
                        <th className="py-2.5 px-3 text-right">
                          {selectedLocationId === 'ALL' ? 'Total Quantity' : `Stock at ${selectedLocationObj?.code || 'Loc'}`}
                        </th>
                        {selectedLocationId === 'ALL' && (
                          <th className="py-2.5 px-3">Location Breakdown</th>
                        )}
                        <th className="py-2.5 px-3 text-right">Min Stock</th>
                        <th className="py-2.5 px-3 text-right">WAC Rate (₹)</th>
                        <th className="py-2.5 px-3 text-right">Total Value</th>
                        <th className="py-2.5 px-3 text-center">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredItems.map((i) => {
                        const totalQty = Number(i.current_quantity || 0);
                        const locQty = selectedLocationId !== 'ALL'
                          ? (itemLocQtyLookup[i.item_id]?.[selectedLocationId] || 0)
                          : totalQty;
                        const isLow = totalQty <= Number(i.minimum_stock) && Number(i.minimum_stock) > 0;
                        const isActive = i.is_active !== false;
                        const locList = (itemLocationStockMap[i.item_id] || []).filter((l) => l.quantity > 0);
                        const expInfo = itemExpiryMap[i.item_id];

                        return (
                          <tr
                            key={i.item_id}
                            className={`hover:bg-stone-50/80 transition-colors ${
                              !isActive ? 'opacity-60 bg-stone-50/30' : ''
                            }`}
                          >
                            <td className="py-3 px-3 font-mono font-bold text-amber-700">
                              <button
                                type="button"
                                onClick={() => setSelectedMovementItem(i)}
                                className="hover:underline hover:text-amber-800 cursor-pointer font-mono text-left"
                                title="Click to view movement ledger"
                              >
                                {i.item_code}
                              </button>
                            </td>
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => setSelectedMovementItem(i)}
                                className="font-semibold text-stone-900 hover:text-amber-700 hover:underline cursor-pointer text-left block"
                                title="Click to view movement ledger"
                              >
                                {i.name}
                              </button>
                              {expInfo && (
                                <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${expInfo.daysLeft <= 0 ? 'text-rose-600 font-bold' : expInfo.daysLeft <= 30 ? 'text-amber-600 font-medium' : 'text-stone-400'}`}>
                                  <Calendar className="h-2.5 w-2.5" />
                                  Exp: {expInfo.expiry_date} ({expInfo.daysLeft <= 0 ? 'EXPIRED' : `${expInfo.daysLeft}d left`})
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-stone-600">
                              {i.category_name || 'General'} <span className="text-stone-400">({i.inventory_class})</span>
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-sm text-stone-900 whitespace-nowrap">
                              {locQty.toFixed(2)}{' '}
                              <span className="text-xs font-normal text-stone-500">{i.unit_symbol || 'units'}</span>
                            </td>
                            {selectedLocationId === 'ALL' && (
                              <td className="py-3 px-3">
                                {locList.length === 0 ? (
                                  <span className="text-stone-400 text-[11px]">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1 max-w-[240px]">
                                    {locList.map((loc) => (
                                      <span
                                        key={loc.location_id}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-100 border border-stone-200 text-[10px] font-mono text-stone-700"
                                        title={`${loc.location_name}: ${loc.quantity} ${i.unit_symbol}`}
                                      >
                                        <span className="font-bold text-amber-800">{loc.location_code}</span>: {loc.quantity}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            )}
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
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedMovementItem(i)}
                                  className="h-7 px-2 text-stone-600 hover:text-amber-700"
                                  title="View movement ledger"
                                >
                                  <History className="h-3.5 w-3.5 mr-1 text-amber-600" /> Ledger
                                </Button>
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
                <CardDescription>Physical Count Audits</CardDescription>
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
                <CardDescription>Location Transfers &amp; Issues</CardDescription>
                <div className="text-2xl font-bold text-blue-700 mt-1">
                  {totalTransfersLogged.length} <span className="text-xs font-normal text-stone-500">transfers</span> / {totalIssuesLogged.length} <span className="text-xs font-normal text-stone-500">issues</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-[11px] text-stone-500">
                Total Issues Value: {formatINR(totalIssuesValue)}
              </CardContent>
            </Card>
          </div>

          {/* Movement Filters */}
          <div className="space-y-3 bg-white p-3.5 border border-stone-200 rounded-xl text-xs shadow-xs">
            {/* Quick Movement Type Buttons */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-xs font-semibold text-stone-500 shrink-0 mr-1">Type:</span>
              {[
                { id: 'ALL', label: 'All Movements' },
                { id: 'count_adjustment', label: 'Count Audits' },
                { id: 'purchase', label: 'Purchases' },
                { id: 'transfer', label: 'Transfers' },
                { id: 'consumption_issue', label: 'Store Issues' },
                { id: 'sale', label: 'Direct Sales' },
                { id: 'breakage', label: 'Breakage/Loss' },
                { id: 'opening', label: 'Opening' },
                { id: 'wastage', label: 'Wastage' },
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

            {/* Filter Bar Row: Item, Location & Search */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-stone-100">
              {/* Location Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-stone-500 font-medium shrink-0">Location:</span>
                <select
                  value={movementLocationFilter}
                  onChange={(e) => setMovementLocationFilter(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 py-1.5 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white"
                >
                  <option value="ALL">All Locations</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Item Filter Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="text-stone-500 font-medium shrink-0">SKU:</span>
                <select
                  value={movementItemFilter}
                  onChange={(e) => setMovementItemFilter(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 py-1.5 px-2.5 text-xs text-stone-900 focus:outline-none focus:border-amber-500 bg-white truncate"
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
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search SKU, reason, batch..."
                  value={movementSearch}
                  onChange={(e) => setMovementSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Movement Ledger Table */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-stone-100">
              <div>
                <CardTitle>Stock Movement Ledger ({filteredMovements.length})</CardTitle>
                <CardDescription>
                  Chronological transaction log with location route, batches, issues, and physical count audit adjustments
                </CardDescription>
              </div>
              <Link href="/inventory/count">
                <Button variant="outline" size="sm" className="gap-1.5 text-stone-700">
                  <ClipboardList className="h-3.5 w-3.5 text-amber-600" /> New Stock Audit
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
                        <th className="py-2.5 px-3 text-center">Type</th>
                        <th className="py-2.5 px-3">Location Route</th>
                        <th className="py-2.5 px-3 text-right">Quantity</th>
                        <th className="py-2.5 px-3 text-right">Rate (₹)</th>
                        <th className="py-2.5 px-3 text-right">Total Value</th>
                        <th className="py-2.5 px-3">Purpose &amp; Batch</th>
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
                            <td className="py-3 px-3 whitespace-nowrap">
                              {m.source_location && m.destination_location ? (
                                <div className="flex items-center gap-1 font-mono text-[11px] text-stone-700">
                                  <span className="font-bold text-amber-800">{m.source_location.code}</span>
                                  <ArrowRightLeft className="h-3 w-3 text-stone-400" />
                                  <span className="font-bold text-emerald-800">{m.destination_location.code}</span>
                                </div>
                              ) : m.destination_location ? (
                                <div className="font-mono text-[11px] text-emerald-700">
                                  ➔ <span className="font-bold">{m.destination_location.code}</span> ({m.destination_location.name})
                                </div>
                              ) : m.source_location ? (
                                <div className="font-mono text-[11px] text-amber-800">
                                  <span className="font-bold">{m.source_location.code}</span> ➔
                                </div>
                              ) : (
                                <span className="text-stone-400 font-mono text-[10px]">—</span>
                              )}
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
                              {m.batch_number && (
                                <div className="text-[10px] text-stone-500 font-mono flex items-center gap-1">
                                  Batch: {m.batch_number} {m.expiry_date && `| Exp: ${m.expiry_date}`}
                                </div>
                              )}
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
          setItemModalOpen(false)
          setEditingItem(null)
        }}
        item={editingItem}
        onSaved={() => {
          setItemModalOpen(false)
          setEditingItem(null)
          loadData()
          loadMovements()
        }}
      />

      <UnitModal
        isOpen={unitModalOpen}
        onClose={() => setUnitModalOpen(false)}
        onUpdated={() => {
          loadData()
          loadMovements()
        }}
      />

      <ItemMovementDrawer
        isOpen={Boolean(selectedMovementItem)}
        onClose={() => setSelectedMovementItem(null)}
        item={selectedMovementItem}
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