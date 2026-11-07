import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import vm from "node:vm";
import {
  normalizeRegistration,
  validRegistration,
  normalizePhone,
  normalizeInvoice,
  moneyToPaise,
  classifyVehicle,
} from "../src/lib/marketing/domain.ts";
import {
  normalizeOrderTimestamp,
  assertSingleReportDay,
} from "../src/lib/petpooja/order-timestamp.ts";
import { getBusinessDateRange } from "../src/lib/business-date-ranges.ts";
test("registration identities preserve broad formats, normalize presentation only", () => {
  for (const value of ["up 16-ab-0012", "UP16AB0012", "ＵＰ１６ＡＢ００１２"])
    assert.equal(normalizeRegistration(value), "UP16AB0012");
  for (const value of ["22 BH 1234 AA", "DL1C1234", "UP16AB0012"])
    assert.equal(validRegistration(value), true);
  assert.equal(validRegistration("UP16/AB0012"), false);
  assert.equal(validRegistration("UP16"), false);
});
test("Indian phone uniqueness and invoices use different normalization rules", () => {
  for (const value of ["9876543210", "09876543210", "+91 (98765) 43210"])
    assert.equal(normalizePhone(value), "+919876543210");
  assert.throws(() => normalizePhone("111"), /INVALID_PHONE/);
  assert.equal(normalizeInvoice(" 001/a-02 "), "001/A-02");
  assert.notEqual(normalizeInvoice("0001"), normalizeInvoice("1"));
});
test("money uses exact paise and refuses extra precision", () => {
  assert.equal(moneyToPaise("25.50"), BigInt(2550));
  assert.equal(moneyToPaise("0.10") + moneyToPaise("0.20"), BigInt(30));
  assert.equal(moneyToPaise("-0.01"), BigInt(-1));
  assert.throws(() => moneyToPaise("1.001"), /INVALID_AMOUNT/);
});
test("vehicle metrics separate bikes, travellers and buses; legacy non-bike rows stay cars", () => {
  assert.equal(classifyVehicle({ vehicle_prefix: "Bike" }), "bikes");
  assert.equal(classifyVehicle({ location: { name: "Bike" } }), "bikes");
  assert.equal(classifyVehicle({ vehicle_category: "BUS" }), "buses");
  assert.equal(
    classifyVehicle({ vehicle_category: "TRAVELLER" }),
    "travellers",
  );
  assert.equal(classifyVehicle({ vehicle_category: "CAR_7" }), "cars");
  assert.equal(classifyVehicle({ vehicle_prefix: "UP16" }), "cars");
});
test("timestamps normalize midnight, 12-hour values, year-end and explicit UTC correctly", () => {
  assert.equal(
    normalizeOrderTimestamp("31-12-2026 00:01"),
    "2026-12-31T00:01:00+05:30",
  );
  assert.equal(
    normalizeOrderTimestamp("1 Jan 2027 12:01 AM"),
    "2027-01-01T00:01:00+05:30",
  );
  assert.equal(
    normalizeOrderTimestamp("2026-11-06 12:05 PM"),
    "2026-11-06T12:05:00+05:30",
  );
  assert.equal(
    normalizeOrderTimestamp("2026-11-05T19:00:00Z"),
    "2026-11-05T19:00:00.000Z",
  );
  assert.throws(
    () => normalizeOrderTimestamp("31-02-2026 12:00"),
    /INVALID_ORDER_TIMESTAMP/,
  );
  assert.throws(
    () => normalizeOrderTimestamp("2026-11-06"),
    /INVALID_ORDER_TIMESTAMP/,
  );
  const day = (s) => s.trim().slice(0, 10);
  assert.throws(
    () => assertSingleReportDay("2026-11-01 to 2026-11-02", day),
    /MULTI_DAY/,
  );
  assert.doesNotThrow(() =>
    assertSingleReportDay("2026-11-01 to 2026-11-01", day),
  );
});
test("actual Petpooja workbook parser preserves invoice strings, channels and report dates", () => {
  const nativeRequire = createRequire(import.meta.url),
    cache = new Map();
  function sourceModule(path) {
    path = resolve(path);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const js = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;
    const require = (name) =>
      name.startsWith(".")
        ? sourceModule(resolve(dirname(path), name + ".ts"))
        : nativeRequire(name);
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
      filename: path,
    })(require, module, module.exports);
    return module.exports;
  }
  const { parsePetpoojaBuffer } = sourceModule("src/lib/petpooja/parser.ts");
  const xlsx = nativeRequire("xlsx");
  const workbook = (period) => {
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.aoa_to_sheet([
        ["Orders: Master Report"],
        ["Date:", period],
        [
          "Invoice No.",
          "Date",
          "Order Type",
          "Payment Type",
          "Area",
          "Status",
          "Covers",
          "Gross Amount",
          "Discount",
          "Net Sales",
          "Total Tax",
          "Grand Total",
        ],
        [
          "001/A",
          "06-11-2026 00:05",
          "Delivery (Parcel)",
          "Lancho",
          "LANCHO",
          "Success",
          3,
          400,
          100,
          300,
          15,
          315,
        ],
      ]),
      "TEST",
    );
    return xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
  };
  const parsed = parsePetpoojaBuffer(
    workbook("2026-11-05 to 2026-11-05"),
    "TEST-uploaded-next-day.xlsx",
  );
  assert.equal(parsed.businessDate, "2026-11-05");
  assert.equal(parsed.data[0].invoice_no, "001/A");
  assert.equal(parsed.data[0].order_type, "Delivery (Parcel)");
  assert.equal(parsed.data[0].area, "LANCHO");
  assert.equal(parsed.data[0].hour_of_day, 0);
  assert.equal(parsed.data[0].order_timestamp, "2026-11-06T00:05:00+05:30");
  assert.equal(parsed.data[0].net_sales, 300);
  assert.equal(parsed.data[0].covers_pax, 3);
  assert.throws(
    () =>
      parsePetpoojaBuffer(workbook("2026-11-05 to 2026-11-06"), "TEST.xlsx"),
    /MULTI_DAY_ORDERS_UNSUPPORTED/,
  );
});
test("completed periods follow IST across midnight and month/year boundaries", () => {
  assert.equal(
    getBusinessDateRange("yesterday", new Date("2026-12-31T18:29:59Z")).from,
    "2026-12-30",
  );
  assert.equal(
    getBusinessDateRange("yesterday", new Date("2026-12-31T18:30:00Z")).from,
    "2026-12-31",
  );
  assert.equal(
    getBusinessDateRange("this_month", new Date("2026-12-31T18:30:00Z")).status,
    "empty",
  );
  assert.deepEqual(
    getBusinessDateRange("7d", new Date("2027-01-01T01:00:00+05:30")),
    { from: "2026-12-25", to: "2026-12-31", status: "ready" },
  );
});
test("active pages retire footfall while offline history remains syncable", () => {
  for (const file of [
    "src/app/dashboard/page.tsx",
    "src/app/operations/daily/page.tsx",
    "src/app/reports/page.tsx",
    "src/app/operations/gate/page.tsx",
    "src/app/api/operations/gate/analytics/route.ts",
  ]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\.from\(['"]visitor_counter_events/);
    assert.doesNotMatch(
      text,
      /gateFootfall|dinerConversionRate|handleAddVisitors/,
    );
  }
  assert.match(
    readFileSync("src/lib/gate/sync-engine.ts", "utf8"),
    /visitor_counter_events/,
  );
  assert.match(
    readFileSync("src/lib/gate/offline-store.ts", "utf8"),
    /DB_VERSION = 1/,
  );
  for (const page of ["dashboard", "operations/daily", "reports"])
    assert.match(
      readFileSync(`src/app/${page}/page.tsx`, "utf8"),
      /<OperatingMetrics /,
    );
});
test("bilingual marketing dictionaries have identical leaves and placeholder sets", () => {
  const en = JSON.parse(readFileSync("src/locales/en/marketing.json", "utf8")),
    hi = JSON.parse(readFileSync("src/locales/hi/marketing.json", "utf8"));
  function leaves(o, p = "") {
    return Object.entries(o).flatMap(([k, v]) =>
      typeof v === "string" ? [[p + k, v]] : leaves(v, `${p + k}.`),
    );
  }
  const a = leaves(en),
    b = new Map(leaves(hi));
  assert.equal(a.length, b.size);
  for (const [key, value] of a) {
    assert.ok(b.has(key), key);
    assert.deepEqual(
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      [...b.get(key).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      key,
    );
  }
});
