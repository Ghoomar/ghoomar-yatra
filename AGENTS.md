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
