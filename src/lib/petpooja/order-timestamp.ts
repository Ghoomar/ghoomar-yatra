/** Petpooja timestamps without an offset are restaurant-local, not server-local. */
export function normalizeOrderTimestamp(raw: string): string {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime()))
      throw new Error("INVALID_ORDER_TIMESTAMP");
    return instant.toISOString();
  }
  let date = "";
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  const textual = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (dmy)
    date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  else if (textual) {
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const month = months.indexOf(textual[2].slice(0, 3).toLowerCase()) + 1;
    if (month)
      date = `${textual[3]}-${String(month).padStart(2, "0")}-${textual[1].padStart(2, "0")}`;
  }
  const time = value.match(
    /(?:\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );
  if (!date || !time) throw new Error("INVALID_ORDER_TIMESTAMP");
  let hour = Number(time[1]);
  const minute = Number(time[2]),
    second = Number(time[3] || 0);
  if (time[4]) {
    if (hour < 1 || hour > 12) throw new Error("INVALID_ORDER_TIMESTAMP");
    hour = (hour % 12) + (time[4].toUpperCase() === "PM" ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59)
    throw new Error("INVALID_ORDER_TIMESTAMP");
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.toISOString().slice(0, 10) !== date)
    throw new Error("INVALID_ORDER_TIMESTAMP");
  return `${date}T${String(hour).padStart(2, "0")}:${time[2]}:${String(second).padStart(2, "0")}+05:30`;
}
export function assertSingleReportDay(
  candidate: string,
  normalizeDate: (raw: string) => string,
): void {
  const boundaries = candidate
    .split(/\s+to\s+|\s+[–—]\s+/i)
    .map(normalizeDate)
    .filter(Boolean);
  if (new Set(boundaries).size > 1)
    throw new Error("MULTI_DAY_ORDERS_UNSUPPORTED");
}
