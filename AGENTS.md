<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ghoomar Yatra: First-Class Bilingual Localization Architecture (English & Hindi)

## Permanent Core Standards
1. **Bilingual by Design**: Yatra is an application-level bilingual platform supporting English (`en`) and Hindi (`hi`).
2. **Presentation-Only Concern**: Localization is strictly an application-level presentation concern. Never rely on browser translation, Google Translate layers, URL-path prefixes (e.g. `/hi/...`), or duplicate page files.
3. **Identical Route & Business Logic**: English and Hindi use the exact same routes (e.g., `/operations/gate`), the exact same components, the exact same permissions, the exact same calculations, the exact same database operations, and the exact same APIs.
4. **All UI Strings Translatable**: All application-controlled user-facing strings must be retrieved via `t('<namespace>.<key>', params)` from `src/lib/i18n/context`. Hardcoded user-facing English strings in JSX/TSX or configuration objects are strictly prohibited.
5. **Canonical Terminology Glossary**: Developers must adhere to the canonical Yatra Terminology Glossary:
   - Attendance -> हाजिरी (उपस्थिति in formal reports)
   - Present / Absent -> उपस्थित / अनुपस्थित
   - Store / Storekeeper -> स्टोर / स्टोरकीपर
   - Stock / Issues -> स्टॉक / स्टोर निकासी
   - Purchase / Bills -> खरीद / बिल
   - Vendors -> वेंडर
   - Gate Counter -> गेट काउंटर
   - Visitors / Footfall -> आगंतुक (UI) / फुटफॉल (Analytics)
   - Vehicles / Car / Bike -> वाहन / कार / बाइक
   - P&L / Daily Closing -> दैनिक P&L / दैनिक क्लोजिंग
6. **English Allowlist (Intentionally Untranslated)**:
   - Indian currency symbol `₹` and all numbers (Arabic numerals `1, 2, 3...`) must remain in numeric format.
   - Vehicle registration RTO state prefix codes (`DL`, `UP16`, `UP22`, `UP23`, `HR`, `UK`) must remain in English for gate staff number-plate matching.
   - SKU / Item codes (e.g. `KIT-001`, `ING-012`).
   - Technical brand names and acronyms (`Petpooja`, `UPI`, `NEFT`, `P&L`, `WAC`).
7. **Controlled Master Data**:
   - Master data tables (`departments`, `teams`, `employee_roles`, `units`, `inventory_categories`, `sales_categories`, `expense_categories`, `vendor_categories`) support explicit bilingual values via `name_hi` (and `symbol_hi` for units).
   - Use `getLocalizedMasterName(item, locale)` to resolve display names. Existing English data must remain intact.
8. **Parity Verification**:
   - All translation keys in `src/locales/en/` must exist in `src/locales/hi/`.
   - Run `npm run check:i18n` to verify 100% key parity across all namespaces before committing.

# Ghoomar Yatra: Sales, Business Units & Channel Architecture

## 1. Snacks Stall vs. Lancho Delivery Rules
1. **Snacks Stall Derived Classification**:
   - In Petpooja POS at Ghoomar Yatra, order type `Delivery(Parcel)` / `Delivery (Parcel)` is **exclusively** used for the physical Snacks Stall counter.
   - In Yatra analytics and reporting, `Delivery (Parcel)` maps to Business Unit: **Snacks Stall**.
2. **Raw Database Preservation**:
   - The original Petpooja `order_type` must remain **verbatim and unchanged** in the raw imported database (`sales_orders`). Never mutate raw imported order types to `Snacks Stall` in the database.
   - Business Unit classification is strictly an application-level derived calculation using `@/lib/sales/business-units`.
3. **Lancho is NEVER Snacks Stall**:
   - Lancho is an independent delivery platform/channel. Orders associated with Lancho (`area = 'LANCHO'`, `order_type = 'LANCHO'`, or `payment_type ILIKE '%lancho%'`) must be classified as **Lancho**, never Snacks Stall.
4. **Configurable Lancho Commission**:
   - Lancho operates with a variable commission (currently ~15–20%). Never hardcode this percentage.
   - Managed under `Settings -> Payment Methods & Commissions` (`payment_methods.commission_percent`) and dynamically applied as a variable operating cost to Lancho sales in Daily P&L.

# Ghoomar Yatra: Menu Category & Colour Architecture

## 1. Single Source of Truth
- `Settings → Menu Master` (`src/components/admin/menu/`) is the **single source of truth** for `Parent Category → Category → Menu Item`.
- **Strict Hierarchy**: ONE menu item record belongs to ONE Category, which belongs to ONE Parent Category. No duplicate English/Hindi records or parallel category systems.

## 2. Complete Self-Service UI Management
- Managers can perform all hierarchy actions directly in the UI without developer intervention or CSV re-uploads:
  1. Create / edit Parent Categories.
  2. Create / edit Subcategories under Parent Categories.
  3. Edit any Menu Item and reassign both its Parent Category and Subcategory.
  4. Move items dynamically across categories.
  5. Add brand-new menu items and integrate them into the hierarchy.

## 3. Parent Category Colour Architecture
- Each Parent Category has an authoritative color stored in `pos_parent_categories.color`.
- Managers can select and update Parent Category colors via the color picker and preset palette in Menu Master.
- **Deterministic Color Resolution**: All reports, hourly stacked bar charts, tables, badges, and legends resolve colors strictly from this Parent Category mapping (falling back to canonical colors or deterministic string hashing). **Array-index (`idx`) and chart-order-based color assignment are strictly prohibited**.

