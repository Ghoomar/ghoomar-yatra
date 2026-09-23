/**
 * Advanced ICU pluralization and dynamic message interpolation for Ghoomar Yatra i18n.
 * Ensures ICU plural syntax like `{count, plural, one {item has} other {items have}}`
 * is correctly rendered into localized text and never leaks raw syntax to the UI.
 */

export function interpolateTranslation(
  template: string,
  params?: Record<string, string | number | null | undefined>,
  locale: string = 'en'
): string {
  if (!template) return '';

  // If no params supplied, strip any raw ICU plural blocks so they never leak into UI
  if (!params) {
    let cleaned = '';
    let i = 0;
    while (i < template.length) {
      const pluralStart = template.indexOf('{', i);
      if (pluralStart === -1) {
        cleaned += template.slice(i);
        break;
      }
      const pluralMatch = template.slice(pluralStart).match(/^\{\s*(\w+)\s*,\s*plural\s*,\s*/);
      if (pluralMatch) {
        cleaned += template.slice(i, pluralStart);
        let depth = 1;
        let j = pluralStart + pluralMatch[0].length;
        while (j < template.length && depth > 0) {
          if (template[j] === '{') depth++;
          else if (template[j] === '}') depth--;
          j++;
        }
        i = j;
      } else {
        cleaned += template.slice(i, pluralStart + 1);
        i = pluralStart + 1;
      }
    }
    return cleaned;
  }

  let result = '';
  let i = 0;

  // 1. Process ICU plural syntax blocks using balanced-brace parsing
  while (i < template.length) {
    const pluralStart = template.indexOf('{', i);
    if (pluralStart === -1) {
      result += template.slice(i);
      break;
    }

    const pluralMatch = template.slice(pluralStart).match(/^\{\s*(\w+)\s*,\s*plural\s*,\s*/);
    if (pluralMatch) {
      result += template.slice(i, pluralStart);
      const varName = pluralMatch[1];
      let depth = 1;
      const bodyStart = pluralStart + pluralMatch[0].length;
      let j = bodyStart;
      while (j < template.length && depth > 0) {
        if (template[j] === '{') depth++;
        else if (template[j] === '}') depth--;
        j++;
      }

      const body = template.slice(bodyStart, j - 1);
      i = j;

      const rawVal = params[varName];
      const num = Number(rawVal);
      const count = isNaN(num) ? 0 : num;

      // Extract branch options, e.g. "one {item has} other {items have}"
      const branchRegex = /(=?\w+)\s*\{([^}]*)\}/g;
      const branches: Record<string, string> = {};
      let match: RegExpExecArray | null;
      while ((match = branchRegex.exec(body)) !== null) {
        branches[match[1]] = match[2];
      }

      // 1a. Check exact match (=0, =1, etc.)
      if (branches[`=${count}`] !== undefined) {
        result += branches[`=${count}`].replace(/#/g, String(count));
      } else {
        // 1b. Use Intl.PluralRules according to the active locale
        let category = 'other';
        try {
          category = new Intl.PluralRules(locale).select(count);
        } catch {
          category = count === 1 ? 'one' : 'other';
        }

        const selectedText =
          branches[category] ??
          branches['other'] ??
          branches['one'] ??
          (Object.values(branches)[0] || '');

        result += selectedText.replace(/#/g, String(count));
      }
    } else {
      result += template.slice(i, pluralStart + 1);
      i = pluralStart + 1;
    }
  }

  // 2. Perform variable interpolation for standard {varName} placeholders
  result = result.replace(/\{(\w+)\}/g, (_, match) => {
    return params[match] !== undefined && params[match] !== null ? String(params[match]) : `{${match}}`;
  });

  return result;
}
