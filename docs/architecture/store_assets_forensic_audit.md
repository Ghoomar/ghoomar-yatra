# Forensic Audit & Architecture Plan: Inventory vs. Physical Assets vs. Uniforms

**Document Version:** 1.0.0  
**Audit Date:** 2026-10-06  
**Auditor:** Antigravity AI Pair Programmer  
**System:** Ghoomar Yatra Operations & ERP Engine  
**Target File:** `docs/architecture/store_assets_forensic_audit.md`  

---

## Table of Contents
1. [Section A: Executive Summary](#section-a-executive-summary)
2. [Section B: Chair Forensic Reconciliation (The 111 vs 116 Discrepancy)](#section-b-chair-forensic-reconciliation-the-111-vs-116-discrepancy)
3. [Section C: Data Model Topology & Table Audits](#section-c-data-model-topology--table-audits)
4. [Section D: Item Master Architecture & Classification](#section-d-item-master-architecture--classification)
5. [Section E: Purchasing & Inward Flows](#section-e-purchasing--inward-flows)
6. [Section F: Valuation & Accounting Impact (WAC vs. Asset Capitalization)](#section-f-valuation--accounting-impact-wac-vs-asset-capitalization)
7. [Section G: Movement & Transfer Architecture](#section-g-movement--transfer-architecture)
8. [Section H: Breakage, Loss & Repair Workflows](#section-h-breakage-loss--repair-workflows)
9. [Section I: Physical Count & Reconciliation Workflows](#section-i-physical-count--reconciliation-workflows)
10. [Section J: Uniform Lifecycle & Staff Assignments](#section-j-uniform-lifecycle--staff-assignments)
11. [Section K: Location Stocks & Multi-Location Topology](#section-k-location-stocks--multi-location-topology)
12. [Section L: UI/UX Surface Map & Information Architecture](#section-l-uiux-surface-map--information-architecture)
13. [Section M: Database Integrity & Constraints Audit](#section-m-database-integrity--constraints-audit)
14. [Section N: Permission & Access Control (RLS & Roles)](#section-n-permission--access-control-rls--roles)
15. [Section O: Legacy vs. Active Code & Tables Audit](#section-o-legacy-vs-active-code--tables-audit)
16. [Section P: Single Source of Truth (SSOT) Analysis](#section-p-single-source-of-truth-ssot-analysis)
17. [Section Q: Recommended Target Architecture Options](#section-q-recommended-target-architecture-options)
18. [Section R: Proposed Migration & Consolidation Plan](#section-r-proposed-migration--consolidation-plan)
19. [Section S: Risk Analysis & Mitigations](#section-s-risk-analysis--mitigations)
20. [Section T: Explicit Decision List (Stakeholder Sign-Off)](#section-t-explicit-decision-list-stakeholder-sign-off)

---

## Section A: Executive Summary

A comprehensive forensic audit of Ghoomar Yatra's Store, Inventory, Physical Assets, and Uniform subsystems was performed against the live database (`zklzzfsxibewekkvslzg`) and production codebase.

### Primary Discoveries:
1. **The Item Master Is Already Shared**: Contrary to superficial appearances, the application does *not* maintain separate master tables for inventory items, physical assets, and uniforms. The single source of truth for all three categories is `inventory_items`, distinguished only by the `inventory_class` enum: `'Food Raw Material'`, `'Non-Food Consumable'`, `'Physical Asset'`, and `'Uniform'`.
2. **Orphaned / Legacy Tables Exist**: Early database schema prototypes introduced standalone tables `physical_assets` (1 row), `asset_movements` (1 row), and `uniform_items` (3 rows). These tables are **not used** by the active transactional engines. The active user interfaces (`/inventory/assets`, `/uniforms`, `/inventory`, `/finance/purchases`) query and mutate `inventory_items`, `item_location_stocks`, and `stock_movements`.
3. **The Chair Discrepancy (111 vs. 116) Is Explained Down to the Exact Timestamp and Formula**:
   - `inventory_items.current_stock` for Chair (`AST-002`) is **111.000**.
   - Location stocks across the 4 physical dining and restroom areas total exactly **111.000** (Maharani: 55, Maharaja: 45, Men's Bathroom: 10, Central Store: 1).
   - Total historical purchases equal **121 chairs** (PO-868453: 100 pcs; PO-850696: 21 pcs).
   - On 2026-09-15 17:05:44, **5 chairs were logged as lost** in the Physical Asset modal. This deducted 5 chairs from active inventory stock via `execute_inventory_transaction` and logged 5 lost chairs into `physical_asset_status_ledger`.
   - On 2026-09-15 17:08:33, a Monthly Physical Verification count adjustment deducted another **5 chairs** from Central Store.
   - The Physical Assets UI (`src/app/inventory/assets/page.tsx`, lines 89–95) computes:
     $$\text{Total Owned} = \text{In Service (111)} + \text{Net Broken (0)} + \text{Lost (5)} = 116 \text{ pcs}$$
   - **Root Cause:** Both screens read the exact same item row. The difference is that `/inventory/assets` adds lost chairs back to current stock and labels the sum "Total Owned".
4. **Severe Valuation Collision**: Because Physical Assets (Chairs ₹3.12 Lakhs, Spoons ₹1,100, Dispensers ₹3,500) and Uniforms (₹18,900) are stored in `inventory_items`, **₹3,44,499.91 (25.5%)** of Yatra's ₹13.52 Lakh total inventory valuation consists of capital furniture, equipment, and staff clothing rather than consumable operating stock.
5. **Architectural Recommendation**: Retain `inventory_items` as the unified physical item master, but strictly isolate financial valuation, issue workflows, and physical counts by `inventory_class` to eliminate false Capex inventory inflation and operational cross-contamination.

---

## Section B: Chair Forensic Reconciliation (The 111 vs 116 Discrepancy)

### 1. The Discrepancy Stated
- **Inventory Stock & Master Items (`/inventory`):**
  - Item Code: `AST-002`
  - Name: `Chair`
  - Current Stock: `111 pcs`
  - WAC Unit Cost: `₹2,810.81`
  - Total Stock Valuation: `₹3,11,999.91`
- **Physical Assets Register (`/inventory/assets`):**
  - Item Code: `AST-002`
  - Name: `Chair`
  - In Service: `111`
  - Broken: `0`
  - Lost: `5`
  - Total Owned: `116 pcs`

### 2. Forensic Investigation of Database Records
Both screens reference the **identical item ID**:
- `inventory_items.id = '43ef9c3e-2ccc-47b8-9309-60c404e1ed16'`
- `inventory_class = 'Physical Asset'`

#### A. Total Historical Purchases (Inward Receipts)
| Date | PO Number | Vendor | Quantity | Unit Rate | Total Amount |
|---|---|---|---|---|---|
| 2026-09-14 | PO-868453 | Nirakh Milk | 100.00 pcs | ₹3,000.00 | ₹3,00,000.00 |
| 2026-09-15 | PO-850696 | Rahul | 21.00 pcs | ₹2,000.00 | ₹42,000.00 |
| **Total Inward** | | | **121.00 pcs** | | **₹3,42,000.00** |

#### B. Location Allocation in `item_location_stocks`
| Location Code | Location Name | Current Stock Qty |
|---|---|---|
| `STORE` | Central Store Room | 1.000 pcs |
| `HALL-MAHARAJA` | Maharaja Dining Hall | 45.000 pcs |
| `HALL-MAHARANI` | Maharani Dining Hall | 55.000 pcs |
| `REST-MEN` | Men's Bathroom | 10.000 pcs |
| **Total Distributed** | | **111.000 pcs** |

#### C. Operational Status Events in `physical_asset_status_ledger`
| Event ID | Timestamp | Event Type | Quantity | Location | Notes |
|---|---|---|---|---|---|
| `5ddd473d...` | 2026-09-15 17:05:32 | `breakage` | 4.00 pcs | Maharaja Dining Hall | Logged breakage |
| `5eca76af...` | 2026-09-15 17:05:44 | `loss` | 5.00 pcs | Maharaja Dining Hall | Logged loss |
| `1d4542a5...` | 2026-09-15 17:06:07 | `repair` | 4.00 pcs | Maharaja Dining Hall | Repaired and placed in service |

#### D. Chronological Stock Movement Ledger (`stock_movements`)
1. **Initial setup (2026-09-12):** Baseline testing movements net to zero (Opening 30, test wastages -20, count adjustment -10 = 0).
2. **Purchase 1 (2026-09-14):** Inward 100 chairs into `STORE`. Balance = 100.
3. **Transfers (2026-09-15 17:04:59 - 17:05:11):** 30 to Maharaja Hall, 30 to Maharani Hall. Store = 40.
4. **Breakage Event (2026-09-15 17:05:32):** 4 chairs broken at Maharaja Hall. `execute_inventory_transaction` deducted 4 chairs from Maharaja Hall stock. Active balance = 96.
5. **Loss Event (2026-09-15 17:05:44):** 5 chairs lost at Maharaja Hall. `execute_inventory_transaction` deducted 5 chairs from Maharaja Hall stock. Active balance = 91. Row inserted into `physical_asset_status_ledger` (qty = 5).
6. **Repair Event (2026-09-15 17:06:07):** 4 broken chairs repaired and returned to Maharaja Hall. `execute_inventory_transaction` incremented Maharaja Hall by 4. Active balance = 95.
7. **Transfer (2026-09-15 17:06:24):** 5 chairs from Store to Maharaja Hall. Store = 35, Maharaja = 30, Maharani = 30. Active balance = 95.
8. **Physical Count Adjustment (2026-09-15 17:08:33):** Monthly Physical Verification session `d8acec20...` recorded expected 95 chairs, counted 90 chairs, resulting in a variance of **-5 chairs** from `STORE`. Active balance = 90.
9. **Purchase 2 (2026-09-15 / 16):** Inward 21 chairs into `STORE`. Active balance = 90 + 21 = **111 chairs**.
10. **Transfers (2026-09-23):** 25 chairs from Store to Maharaja Hall, 25 chairs to Maharani Hall. Store = 1, Maharaja = 55, Maharani = 55.
11. **Transfer (2026-10-04):** 10 chairs from Maharaja Hall to Men's Bathroom. Maharaja = 45, Maharani = 55, Men's Bathroom = 10, Store = 1. Active balance = **111 chairs**.
12. **Physical Count (2026-10-03):** Monthly Physical Verification `05e460f8...` counted 111 chairs against expected 111 chairs. Variance = 0.

### 3. Forensic Code Root Cause
In `src/app/inventory/assets/page.tsx`, lines 71–96:
```typescript
const processedAssets = (aData || []).map((asset: any) => {
  const itemStatusEvents = (statusData || []).filter((s: any) => s.item_id === asset.id);
  const brokenTotal = itemStatusEvents
    .filter((s: any) => s.event_type === 'breakage')
    .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0); // = 4
  const repairedTotal = itemStatusEvents
    .filter((s: any) => s.event_type === 'repair')
    .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0); // = 4
  const lostTotal = itemStatusEvents
    .filter((s: any) => s.event_type === 'loss')
    .reduce((sum: number, s: any) => sum + Number(s.quantity || 0), 0); // = 5

  const netBroken = Math.max(0, brokenTotal - repairedTotal); // = 0
  const inService = (asset.location_stocks || []).reduce(
    (sum: number, ls: any) => sum + Number(ls.quantity || 0),
    0
  ); // = 111

  return {
    ...asset,
    in_service_qty: inService,       // 111
    broken_qty: netBroken,           // 0
    lost_qty: lostTotal,             // 5
    total_owned_qty: inService + netBroken + lostTotal, // 111 + 0 + 5 = 116
  };
});
```

### 4. Forensic Verdict
- **Why Inventory reports 111:** Inventory Stock strictly represents the **active physical on-hand population** ready for use. 121 were purchased; 10 were deducted (5 via the loss event and 5 via physical count variance); exactly 111 serviceable chairs remain on the premises.
- **Why Physical Assets reports 116:** Physical Assets calculates $\text{In Service (111)} + \text{Lost (5)} = 116$ and labels this **"Total Owned"**.
- **The Discrepancy Is Semantic & Labeling:**
  1. The restaurant does **not** own 116 chairs; it owns 111 usable chairs, and 5 chairs were lost.
  2. Calling $\text{In Service} + \text{Lost}$ "Total Owned" is logically defective. Once an asset is lost or written off, it is no longer owned.
  3. Furthermore, this calculation ignored the 5 chairs deducted during the 2026-09-14 physical count adjustment, creating an arbitrary hybrid number (116) that does not match either the total purchased (121) or the active population (111).
- **Authoritative System:** `inventory_items.current_stock` (111) is the authoritative physical count. The Physical Assets UI calculation must be corrected to display **"Total In Service: 111"** and separate **"Historical Lost: 5"**, rather than adding them into a misleading "Total Owned: 116".

---

## Section C: Data Model Topology & Table Audits

Below is the exhaustive schema and record audit of all 8 tables involved across the three domains.

| Table Name | Role in Current System | Live Row Count | Primary Key | Foreign Keys | Status |
|---|---|---|---|---|---|
| `inventory_items` | **Authoritative Item Master** for Food, Non-Food, Assets, Uniforms | 21 | `id` (uuid) | `category_id`, `unit_id`, `secondary_unit_id` | **ACTIVE CORE** |
| `item_location_stocks` | **Authoritative Location Allocations** for all items | 34 | `id` (uuid) | `item_id`, `location_id` | **ACTIVE CORE** |
| `stock_movements` | **Authoritative Transaction Ledger** (Inwards, Transfers, Issues, Losses) | 181 | `id` (uuid) | `item_id`, `source_loc_id`, `dest_loc_id`, `purchase_id` | **ACTIVE CORE** |
| `physical_asset_status_ledger` | Operational status event ledger (`breakage`, `loss`, `repair`) | 5 | `id` (uuid) | `item_id` $\rightarrow$ `inventory_items(id)`, `location_id` | **ACTIVE** (Asset UI only) |
| `physical_assets` | Prototype physical asset table (spoons only) | 1 | `id` (uuid) | None | **ORPHANED / DEAD** |
| `asset_movements` | Prototype asset movement table | 1 | `id` (uuid) | `asset_id` $\rightarrow$ `physical_assets(id)` | **ORPHANED / DEAD** |
| `uniform_items` | Prototype uniform master with hardcoded balance columns | 3 | `id` (uuid) | None | **LEGACY / RETIRED** |
| `employee_uniform_issues` | Header for uniform kit issuance to staff | 4 | `id` (uuid) | `employee_id` $\rightarrow$ `employees(id)` | **ACTIVE** (Uniform UI) |
| `employee_uniform_issue_items` | Line items for staff uniform issuance | 4 | `id` (uuid) | `issue_id`, `item_id`, `uniform_item_id` (legacy) | **ACTIVE** (Uniform UI) |
| `inventory_counts` | Physical verification session headers | 5 | `id` (uuid) | None | **ACTIVE** (Count UI) |
| `inventory_count_items` | Physical verification counted line items | 55 | `id` (uuid) | `count_id`, `item_id` | **ACTIVE** (Count UI) |

---

## Section D: Item Master Architecture & Classification

### 1. The `inventory_class` Hierarchy
The system uses a Postgres CHECK constraint on `inventory_items.inventory_class`:
```sql
CHECK (inventory_class IN ('Food Raw Material', 'Non-Food Consumable', 'Physical Asset', 'Uniform'))
```

### 2. Live Inventory Item Distribution
| Inventory Class | Item Count | Total Stock Qty | Total Valuation (INR) | % of Total Inventory Value |
|---|---|---|---|---|
| `Food Raw Material` | 9 | 7,529.000 | ₹8,42,947.50 | 62.4% |
| `Non-Food Consumable` | 4 | 1,008.000 | ₹1,64,116.24 | 12.1% |
| `Physical Asset` | 4 | 146.000 | ₹3,25,599.91 | 24.1% |
| `Uniform` | 4 | 50.000 | ₹18,900.00 | 1.4% |
| **Total** | **21** | **8,733.000** | **₹13,51,563.65** | **100.0%** |

### 3. Durable Items in the Master
- **Physical Assets:**
  - `AST-001`: Stainless Steel Table Spoons (Stock: 11 pcs, WAC: ₹100.00, Value: ₹1,100.00)
  - `AST-002`: Chair (Stock: 111 pcs, WAC: ₹2,810.81, Value: ₹3,11,999.91)
  - `AST-003`: Napkin Stand (Stock: 10 pcs, WAC: ₹900.00, Value: ₹9,000.00)
  - `AST-DISP-001`: Wall-Mounted Liquid Soap Dispenser (Stock: 14 pcs, WAC: ₹250.00, Value: ₹3,500.00)
- **Staff Uniforms:**
  - `UNI-001`: Service Khaki Shirt (M) (Stock: 30 pcs, WAC: ₹350.00, Value: ₹10,500.00)
  - `UNI-002`: Chef Coat (White) (L) (Stock: 7 pcs, WAC: ₹550.00, Value: ₹3,850.00)
  - `UNI-003`: Service Khaki Shirt (L) (Stock: 13 pcs, WAC: ₹350.00, Value: ₹4,550.00)
  - `UNI-004`: Tie (Stock: 0 pcs, WAC: ₹0.00, Value: ₹0.00)

---

## Section E: Purchasing & Inward Flows

### 1. Purchasing Route
All purchasing runs through **Finance $\rightarrow$ Purchases & Vendors** (`/finance/purchases`).
- Vendor invoices create `purchase_headers` and `purchase_lines`.
- `purchase_lines.item_id` references `inventory_items(id)`.
- When an invoice is approved, the RPC function `execute_inventory_transaction` is invoked with `movement_type = 'purchase'`.

### 2. Physical Routing on Inward
- All purchased items—whether 50 kg of Atta, 100 Chairs, or 20 Chef Coats—inward into `inventory_locations` where code = `'STORE'` (Central Store Room).
- The transaction increments `item_location_stocks(STORE)` and `inventory_items.current_stock`.

### 3. Valuation & WAC Recalculation
`execute_inventory_transaction` recalculates `inventory_items.current_weighted_average_cost`:
$$\text{New WAC} = \frac{(\text{Prior Stock} \times \text{Prior WAC}) + (\text{Inward Qty} \times \text{Purchase Unit Rate})}{\text{Prior Stock} + \text{Inward Qty}}$$
- On 2026-09-14: 100 Chairs @ ₹3,000 inward $\rightarrow$ WAC = ₹3,000.00.
- On 2026-09-15: 21 Chairs @ ₹2,000 inward against 90 remaining chairs $\rightarrow$ WAC updated to ₹2,810.81.

---

## Section F: Valuation & Accounting Impact (WAC vs. Asset Capitalization)

### 1. Financial Distortion Identified
In standard restaurant accounting and GAAP/Ind AS:
- **Food & Non-Food Consumables** are **Current Inventory** (Current Assets on Balance Sheet, expensed to Cost of Goods Sold upon issue/consumption).
- **Physical Assets** (Tables, Chairs, Dispensers) are **Fixed Assets / Operating Capital Equipment** (Non-Current Assets, capitalized and depreciated over useful life, or expensed immediately if low-value under de-minimis threshold).
- **Staff Uniforms** are **Operating Supplies** (typically expensed upon purchase or tracked off-balance sheet as employee custodial assets).

### 2. Current State Distortion
Because Physical Assets are stored in `inventory_items` and evaluated at WAC:
- **₹3,25,599.91 of furniture and equipment** is currently included in the live "Inventory Valuation" KPI displayed in `/inventory`.
- When 5 chairs were lost, the system logged a stock movement of ₹15,000, treating lost chairs as an operational inventory shrinkage expense.
- No depreciation, asset capitalization date, salvage value, or asset register ID exists on these items.

---

## Section G: Movement & Transfer Architecture

### 1. Movement Types in Active Ledger
The `stock_movements` table records 181 transactions across the following types:
- `purchase`: Inward from vendor to Central Store.
- `transfer`: Inter-location movement (e.g. Store to Maharaja Hall, or Maharaja Hall to Men's Bathroom).
- `issue`: Issued to staff (used for uniform issuance).
- `return`: Returned from staff (used for uniform return) or repaired asset restored.
- `breakage`: Durable asset damaged/broken.
- `loss`: Durable asset lost/missing.
- `count_adjustment`: Variance from physical stock verification.
- `consumption_issue` / `staff_food`: Consumable food issued to kitchen or staff meals.

### 2. Store Issues Exclusions
In `src/app/inventory/issues/page.tsx` (lines 220–248):
- Store issues are **strictly blocked** for `Physical Asset` and `Uniform`:
```typescript
if (it.inventory_class !== 'Food Raw Material' && it.inventory_class !== 'Non-Food Consumable') {
  return false;
}
```
- Durable assets **cannot** be issued through the daily kitchen issue screen.

### 3. Inter-Location Transfers
- Physical assets are transferred across locations via `AssetDetailModal.tsx` (`src/components/inventory/AssetDetailModal.tsx`).
- It updates `item_location_stocks` atomically using `execute_inventory_transaction` with `movement_type = 'transfer'`.

---

## Section H: Breakage, Loss & Repair Workflows

### 1. Current Workflow Implementation
When a physical asset is damaged, lost, or repaired, the action is taken in `AssetDetailModal.tsx`:
1. **Breakage:**
   - User enters quantity and location (e.g. 4 chairs at Maharaja Dining Hall).
   - Calls `execute_inventory_transaction` with `movement_type = 'breakage'`. This decrements location stock and `current_stock`.
   - Inserts row into `physical_asset_status_ledger` with `event_type = 'breakage'`.
2. **Loss:**
   - User enters quantity and location (e.g. 5 chairs at Maharaja Dining Hall).
   - Calls `execute_inventory_transaction` with `movement_type = 'loss'`. Decrements location stock and `current_stock`.
   - Inserts row into `physical_asset_status_ledger` with `event_type = 'loss'`.
3. **Repair:**
   - User enters quantity and destination location (e.g. 4 chairs restored to Maharaja Dining Hall).
   - Calls `execute_inventory_transaction` with `movement_type = 'return'`. Increments location stock and `current_stock`.
   - Inserts row into `physical_asset_status_ledger` with `event_type = 'repair'`.

### 2. Ledger Flaw
`physical_asset_status_ledger` only appends rows; it has no concept of "closing" a breakage event when repaired. Repaired quantity is calculated dynamically as $\max(0, \sum \text{breakage} - \sum \text{repair})$.

---

## Section I: Physical Count & Reconciliation Workflows

### 1. Stock Count Scope (`/inventory/count`)
In `src/app/inventory/count/page.tsx`:
- The page queries `inventory_current_position`, which selects **all active rows in `inventory_items` regardless of class**.
- While a filter dropdown allows filtering by class, the default is `'All'`.
- When staff submit a physical verification, any variance in Physical Assets or Uniforms generates a `count_adjustment` in `stock_movements`, directly modifying `inventory_items.current_stock`.

### 2. Reconciling Past Counts
- On 2026-09-14: Staff counted 90 chairs across the facility (expected 95, variance -5). An automatic count adjustment decremented 5 chairs from `STORE`.
- On 2026-10-03: Staff counted 111 chairs (expected 111, variance 0). Confirmed that 111 physical chairs are present on site.

---

## Section J: Uniform Lifecycle & Staff Assignments

### 1. Architecture of Uniforms
Uniforms follow an employee custodial model:
```
Purchase Inward (PO)
   ↓
Central Store (inventory_items.current_stock & item_location_stocks)
   ↓
Uniform Issuance (/uniforms)
   ├─ Creates employee_uniform_issues header
   ├─ Creates employee_uniform_issue_items (status: 'Issued')
   └─ Calls execute_inventory_transaction(type: 'issue')
         └─ Decrements Central Store Stock
   ↓
Uniform Return (/uniforms)
   ├─ Updates employee_uniform_issue_items (status: 'Returned')
   └─ Calls execute_inventory_transaction(type: 'return')
         └─ Increments Central Store Stock
```

### 2. Live Uniform Balance Reconciliation
- Total Uniforms on hand in Store:
  - `UNI-001` (Service Khaki Shirt M): 30 pcs on hand, 0 issued. Total: 30.
  - `UNI-002` (Chef Coat White L): 7 pcs on hand, 2 issued to Ajay. Total: 9.
  - `UNI-003` (Service Khaki Shirt L): 13 pcs on hand, 20 issued to Nirakh. Total: 33.
  - `UNI-004` (Tie): 0 pcs on hand.
- Active Garments in Staff Custody: **22 garments** (2 Chef Coats + 20 Shirts).
- Total Owned Uniform Inventory: **72 garments** (50 on hand + 22 issued).

---

## Section K: Location Stocks & Multi-Location Topology

### 1. Active Locations in `inventory_locations`
| Location Code | Location Name | Usage Across Classes |
|---|---|---|
| `STORE` | Central Store Room | Consumables, Non-Food, Inward Receipts, Uniforms, Spare Assets |
| `HALL-MAHARAJA` | Maharaja Dining Hall | Physical Assets (Chairs: 45) |
| `HALL-MAHARANI` | Maharani Dining Hall | Physical Assets (Chairs: 55) |
| `REST-MEN` | Men's Bathroom | Physical Assets (Chairs: 10, Soap Dispensers) |
| `KITCHEN` | Kitchen Production Area | Consumables, Dispensers |
| `BAR-SERVICE` | Service Bar Counter | Consumables |
| `FRIDGE-COKE` | Coca-Cola Customer Fridge | Beverages (Consumables) |

### 2. Multi-Location Integrity
- The table `item_location_stocks` tracks quantity per `(item_id, location_id)`.
- For Chair `AST-002`:
  $$\sum \text{Location Stocks} = 1 + 45 + 55 + 10 = 111.000 = \text{inventory\_items.current\_stock}$$
- The invariant $\sum \text{Location Stocks} = \text{current\_stock}$ is maintained 100% across all 21 items.

---

## Section L: UI/UX Surface Map & Information Architecture

### 1. Current Menu & Navigation Structure
- **Inventory Submenu:**
  - `/inventory` $\rightarrow$ Stock & Master Items (displays all 21 items, including assets & uniforms).
  - `/inventory/issues` $\rightarrow$ Store Issues (consumables only, assets blocked).
  - `/inventory/count` $\rightarrow$ Physical Verification (all 21 items included).
  - `/inventory/assets` $\rightarrow$ Physical Assets Register (filtered to `Physical Asset`).
- **Operations / Staff Submenu:**
  - `/uniforms` $\rightarrow$ Uniforms Register & Staff Issuance (filtered to `Uniform`).
- **Finance Submenu:**
  - `/finance/purchases` $\rightarrow$ Inward PO lines for all items.

### 2. Information Redundancy
A storekeeper or manager sees:
1. `Chair` in `/inventory` with a stock count and valuation.
2. `Chair` in `/inventory/assets` with an asset register and location distribution.
3. `Service Khaki Shirt` in `/inventory` with stock and WAC.
4. `Service Khaki Shirt` in `/uniforms` with available vs issued stock.

---

## Section M: Database Integrity & Constraints Audit

1. **Foreign Key Integrity:**
   - `inventory_items` $\rightarrow$ `units` (valid).
   - `inventory_items` $\rightarrow$ `inventory_categories` (valid).
   - `item_location_stocks` $\rightarrow$ `inventory_items` and `inventory_locations` (valid with cascading deletes).
   - `physical_asset_status_ledger` $\rightarrow$ `inventory_items` (valid).
   - `employee_uniform_issue_items` $\rightarrow$ `inventory_items` (valid).
2. **Missing Constraints:**
   - No database trigger enforces that `inventory_items.current_stock` equals $\sum \text{item_location_stocks.quantity}$. This is currently maintained purely by the application RPC `execute_inventory_transaction`.
   - `physical_asset_status_ledger` has no constraint linking a `repair` event to a prior `breakage` event ID.

---

## Section N: Permission & Access Control (RLS & Roles)

1. **Row Level Security (RLS):**
   - Enabled on `inventory_items`, `stock_movements`, `item_location_stocks`, `physical_asset_status_ledger`, `employee_uniform_issues`, `employee_uniform_issue_items`.
   - Authenticated users with role `admin`, `manager`, or `storekeeper` have full read/write access.
2. **Role Enforcements:**
   - Storekeeper can issue stock, perform counts, and log transfers.
   - Manager and Admin can approve counts and create purchase invoices.

---

## Section O: Legacy vs. Active Code & Tables Audit

### 1. Legacy Dead Tables Confirmed
- `physical_assets`: 1 row (`AST-001` Table Spoons, purchase value ₹15,000, condition 'Good', created 2026-09-04).
  - **Code References:** 0 references across the entire codebase (`git grep "physical_assets"` returns zero hits).
  - **Verdict:** Safe to drop or archive.
- `asset_movements`: 1 row (Lost spoons, created 2026-09-08).
  - **Code References:** 0 references across the codebase.
  - **Verdict:** Safe to drop or archive.
- `uniform_items`: 3 rows (`Service Khaki Shirt M`, `Chef Coat L`, `Service Khaki Shirt L`).
  - **Code References:** Referenced only as an optional backwards-compatibility display join (`legacy_uniform:uniform_items(name, size)`) in `src/app/uniforms/page.tsx` and `src/components/people/StaffLedgerDrawer.tsx`.
  - **Verdict:** Safe to retire after migrating any remaining legacy UI fallbacks.

---

## Section P: Single Source of Truth (SSOT) Analysis

| Entity / Dimension | Authoritative Table (Single Source of Truth) | Authoritative Column(s) | Secondary / Derived Views |
|---|---|---|---|
| **Master Item Catalog** | `inventory_items` | `id`, `item_code`, `name`, `inventory_class`, `unit_id` | Master Data Cache, Selectors |
| **Active Physical Stock** | `inventory_items` | `current_stock` | Aggregated from movements |
| **Location Allocation** | `item_location_stocks` | `quantity` per `(item_id, location_id)` | Location breakdown modals |
| **Stock Transaction History** | `stock_movements` | `id`, `movement_type`, `quantity`, `unit_cost`, `total_value` | Inventory audit trails |
| **Asset Operational Events** | `physical_asset_status_ledger` | `event_type`, `quantity`, `location_id`, `created_at` | Asset maintenance log |
| **Staff Uniform Custody** | `employee_uniform_issue_items` | `status = 'Issued'`, `quantity`, `employee_id` | Staff ledger drawer |
| **Inward Procurement** | `purchase_headers` + `purchase_lines` | `quantity`, `rate`, `total_amount` | Vendor statement, Invoices |

---

## Section Q: Recommended Target Architecture Options

### Option 1: Unified Inventory Master with Filtered Presentation (Recommended)
- **Concept:** Maintain `inventory_items` as the unified physical item master for all physical items.
- **Improvements:**
  1. Add an `is_depreciable_asset` or `asset_classification` flag.
  2. Filter `inventory_items` in `/inventory` so that **only Consumables and Food Raw Materials** are counted in the **"Inventory Valuation" KPI** (moving physical asset valuation into a separate "Capital Assets" card).
  3. Correct the formula in `/inventory/assets`:
     $$\text{Total in Service} = 111$$
     $$\text{Historical Lost (Written Off)} = 5$$
     $$\text{Total Historical Inward} = 121$$
     *Remove the confusing "Total Owned: 116" metric.*
  4. Explicitly separate Physical Asset Audits from Consumable Stock Counts in `/inventory/count`.

### Option 2: Complete Database Segregation (Hard Split)
- Create separate tables `fixed_assets` and `uniform_catalog`, completely removing `Physical Asset` and `Uniform` classes from `inventory_items`.
- **Drawbacks:** High migration overhead, breaks existing unified purchase invoice workflow (`purchase_lines.item_id`), duplicates location tracking infrastructure. Not recommended.

---

## Section R: Proposed Migration & Consolidation Plan

*Note: Phase 1 is strictly an audit. No code or schema changes are applied until authorized.*

### Step 1: Clean Up Dead Tables (Post-Approval)
- Remove `legacy_uniform` foreign key fallback in `src/app/uniforms/page.tsx` and `StaffLedgerDrawer.tsx`.
- Drop legacy tables `physical_assets`, `asset_movements`, and `uniform_items`.

### Step 2: Fix the Physical Assets UI Calculation & Labels
- In `src/app/inventory/assets/page.tsx`:
  - Change "Total Owned" to "Total In Service" ($= 111$).
  - Display "Total Lost / Missing" ($= 5$) as a shrinkage metric.
  - Eliminate the addition of lost items back into active on-hand counts.

### Step 3: Isolate Financial Valuation in Inventory
- In `src/app/inventory/page.tsx`:
  - Calculate "Total Inventory Valuation" using `inventory_class IN ('Food Raw Material', 'Non-Food Consumable')` ($= ₹10,07,063.74$).
  - Display a distinct, non-COGS card for "Physical Asset Capital Base" ($= ₹3,25,599.91$) and "Uniforms Issued & Stock" ($= ₹18,900.00$).

### Step 4: Add Verification Scope Filters to Physical Count
- In `/inventory/count`, default the count filter to "Consumables & Food" rather than "All", preventing routine kitchen counts from accidentally adjusting chair and dispenser balances.

---

## Section S: Risk Analysis & Mitigations

1. **Risk: Purchasing Invoice Disruption**
   - *Risk:* If assets or uniforms are separated into another master table, purchasing staff cannot enter chairs or chef coats on standard purchase bills.
   - *Mitigation:* Keep `inventory_items` as the unified master; separate only presentation, valuation KPIs, and issue workflows.
2. **Risk: Historical Movement Continuity**
   - *Risk:* Re-classifying or altering past movements could alter the 181 movement baseline.
   - *Mitigation:* Zero mutations to past `stock_movements` or `purchase_lines`. All adjustments are presentation and KPI refinements.

---

## Section T: Explicit Decision List (Stakeholder Sign-Off)

Please review and confirm each architectural decision below before implementation:

1. **[DECISION 1 - Chair Metric Correction]**: Do you approve changing `/inventory/assets` so that "Total Owned" (116) is replaced by "Total In Service" (111) and "Historical Lost" (5), ending the confusing addition of lost chairs back into current on-hand stock?  
   *Options: YES / NO*

2. **[DECISION 2 - Inventory Valuation KPI Segregation]**: Do you approve excluding Physical Assets (₹3.26L) and Uniforms (₹18.9K) from the primary "Inventory Stock Valuation" KPI in `/inventory`, and showing them in a separate Capital Assets / Uniforms summary so that food & beverage COGS valuation is accurate?  
   *Options: YES / NO*

3. **[DECISION 3 - Dropping Legacy Dead Tables]**: Do you approve creating a migration to permanently drop the orphaned legacy tables `physical_assets` (1 row), `asset_movements` (1 row), and `uniform_items` (3 rows) once remaining UI fallbacks are removed?  
   *Options: YES / NO*

4. **[DECISION 4 - Physical Count Isolation]**: Do you approve defaulting the Monthly Physical Count (`/inventory/count`) to "Consumables & Food" to prevent monthly store counts from inadvertently overriding furniture and uniform balances?  
   *Options: YES / NO*
