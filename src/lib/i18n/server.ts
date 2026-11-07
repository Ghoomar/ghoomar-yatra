import { cookies } from "next/headers";
import { translations } from "@/locales";
import { interpolateTranslation } from "./interpolation";
/** Server metadata uses the same dictionaries and cookie as the UI provider. */
export async function getServerTranslator() {
  const store = await cookies();
  const locale = store.get("ghoomar_locale")?.value === "hi" ? "hi" : "en";
  return (key: string, params?: Record<string, string | number>) => {
    let value: unknown = translations[locale];
    for (const part of key.split("."))
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    return typeof value === "string"
      ? interpolateTranslation(value, params, locale)
      : key;
  };
}
