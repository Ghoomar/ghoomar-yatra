/**
 * Unit conversion & dimensional compatibility engine.
 * Supports mass (kg, g, mg, chutki=0.36g), volume (L, ml), count (pcs, serving), and packaging containers.
 */

export type Dimension = 'MASS' | 'VOLUME' | 'COUNT' | 'CONTAINER' | 'UNKNOWN';

export const UNIT_ALIASES: Record<string, string> = {
  // Mass
  'g': 'g',
  'gm': 'g',
  'gms': 'g',
  'gram': 'g',
  'grams': 'g',
  'ग्राम': 'g',
  'kg': 'kg',
  'kgs': 'kg',
  'kilo': 'kg',
  'kilogram': 'kg',
  'kilograms': 'kg',
  'किलो': 'kg',
  'किलोग्राम': 'kg',
  'mg': 'mg',
  'milligram': 'mg',
  'मिलीग्राम': 'mg',
  'chutki': 'chutki',
  'pinch': 'chutki',
  'चुटकी': 'chutki',

  // Volume
  'ml': 'ml',
  'millilitre': 'ml',
  'milliliter': 'ml',
  'मिली': 'ml',
  'मिलीलीटर': 'ml',
  'l': 'l',
  'ltr': 'l',
  'litre': 'l',
  'liter': 'l',
  'लीटर': 'l',

  // Count
  'pcs': 'pcs',
  'pc': 'pcs',
  'piece': 'pcs',
  'pieces': 'pcs',
  'unit': 'pcs',
  'serving': 'pcs',
  'portion': 'pcs',
  'पीस': 'pcs',

  // Containers
  'btl': 'btl',
  'bottle': 'btl',
  'bottles': 'btl',
  'बोतल': 'btl',
  'pkt': 'pkt',
  'pkts': 'pkt',
  'packet': 'pkt',
  'packets': 'pkt',
  'पैकेट': 'pkt',
  'box': 'box',
  'boxes': 'box',
  'डिब्बा': 'box',
  'tin': 'tin',
  'tins': 'tin',
  'can': 'tin',
  'bag': 'bag',
  'bags': 'bag',
  'बोरी': 'bag',
  'jar': 'jar',
  'jars': 'jar',
};

// Mass factors in grams
const MASS_TO_GRAM: Record<string, number> = {
  'mg': 0.001,
  'g': 1.0,
  'kg': 1000.0,
  'chutki': 0.36, // Standard 0.36g per pinch/chutki
};

// Volume factors in ml
const VOLUME_TO_ML: Record<string, number> = {
  'ml': 1.0,
  'l': 1000.0,
};

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  const clean = unit.trim().toLowerCase();
  return UNIT_ALIASES[clean] || clean;
}

// Physical verified specifications for Moong Papad
export const PAPAD_PHYSICAL_SPECS = {
  MASS_PER_PIECE_GRAMS: 400 / 28, // 14.285714285714286... (Display: 14.286g)
  DISPLAY_MASS_PER_PIECE: '14.286g',
  PIECES_PER_PACKET: 28,
  GRAMS_PER_PACKET: 400,
  PIECES_PER_KG: 70,
  PACKETS_PER_KG: 2.5,
  REFERENCE_RATE_PER_KG: 240,
  REFERENCE_RATE_PER_PACKET: 96,
  REFERENCE_RATE_PER_PIECE: 240 / 70, // 3.4285714285714284...
};

export function getUnitDimension(unit: string): Dimension {
  const norm = normalizeUnit(unit);
  if (norm in MASS_TO_GRAM) return 'MASS';
  if (norm in VOLUME_TO_ML) return 'VOLUME';
  if (['pcs', 'serving', 'portion'].includes(norm)) return 'COUNT';
  if (['btl', 'pkt', 'box', 'tin', 'bag', 'jar'].includes(norm)) return 'CONTAINER';
  return 'UNKNOWN';
}

export interface PackagingUnitSpec {
  packUnit: string;
  packSize: number; // in base units
}

export interface UnitConversionOptions {
  pieceWeightGrams?: number;       // Grams per count piece (e.g. 14.285714... for 400g/28pcs)
  conversionFactor?: number;       // Secondary to base unit multiplier (e.g. 14.285714... for pcs<->g)
  secondaryUnit?: string;          // Symbol of secondary unit (e.g. 'g')
  baseUnit?: string;               // Symbol of base unit (e.g. 'pcs')
  packagingUnits?: PackagingUnitSpec[]; // e.g. [{ packUnit: 'pkt', packSize: 28 }, { packUnit: 'kg', packSize: 70 }]
  itemName?: string;               // Optional label for error diagnostics ONLY (never for logic branching)
}

export interface CentralUnit {
  id?: string;
  name: string;
  name_hi?: string | null;
  symbol: string;
  symbol_hi?: string | null;
  is_active?: boolean;
}

export interface UnitOption {
  value: string;
  label: string;
  dimension?: Dimension;
}

export function areUnitsCompatible(
  unitA: string,
  unitB: string,
  options?: UnitConversionOptions
): boolean {
  const normA = normalizeUnit(unitA);
  const normB = normalizeUnit(unitB);
  if (normA === normB) return true;

  const dimA = getUnitDimension(normA);
  const dimB = getUnitDimension(normB);

  // Same standard dimension (MASS, VOLUME, or COUNT)
  if (dimA !== 'UNKNOWN' && dimA !== 'CONTAINER' && dimA === dimB) return true;

  // Standard culinary liquid density equivalence: 1 g = 1 ml, 1 kg = 1 L
  if ((dimA === 'MASS' && dimB === 'VOLUME') || (dimA === 'VOLUME' && dimB === 'MASS')) return true;

  // Resolve piece weight for Mass <-> Count compatibility
  const pieceWeight = options?.pieceWeightGrams || (
    options?.conversionFactor && (
      (options.baseUnit && normalizeUnit(options.baseUnit) === 'pcs' && (!options.secondaryUnit || normalizeUnit(options.secondaryUnit) === 'g')) ||
      (!options.baseUnit && (normA === 'pcs' || normB === 'pcs') && (dimA === 'MASS' || dimB === 'MASS'))
    ) ? options.conversionFactor : undefined
  );

  if (pieceWeight && pieceWeight > 0) {
    if ((dimA === 'MASS' && dimB === 'COUNT') || (dimA === 'COUNT' && dimB === 'MASS')) return true;
  }

  // Metadata-driven Packaging compatibility
  if (options?.packagingUnits && options.packagingUnits.length > 0) {
    const hasPackA = options.packagingUnits.some(p => normalizeUnit(p.packUnit) === normA);
    const hasPackB = options.packagingUnits.some(p => normalizeUnit(p.packUnit) === normB);
    if (hasPackA || hasPackB) {
      if (hasPackA && (normB === 'pcs' || (pieceWeight && dimB === 'MASS'))) return true;
      if (hasPackB && (normA === 'pcs' || (pieceWeight && dimA === 'MASS'))) return true;
      if (hasPackA && hasPackB) return true;
    }
  }

  return false;
}

/**
 * Converts a quantity from one unit to another within the same dimension (or liquid mass-volume / piece weight / packaging).
 */
export function convertDirectQuantity(
  qty: number,
  fromUnit: string,
  toUnit: string,
  options?: UnitConversionOptions
): { possible: boolean; converted?: number; error?: string } {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) {
    return { possible: true, converted: qty };
  }

  const dimFrom = getUnitDimension(normFrom);
  const dimTo = getUnitDimension(normTo);

  // 1. Standard culinary liquid density equivalence: 1 g = 1 ml
  if ((dimFrom === 'MASS' && dimTo === 'VOLUME') || (dimFrom === 'VOLUME' && dimTo === 'MASS')) {
    if (dimFrom === 'MASS' && dimTo === 'VOLUME') {
      const fromInGrams = qty * MASS_TO_GRAM[normFrom];
      const converted = fromInGrams / VOLUME_TO_ML[normTo];
      return { possible: true, converted };
    } else {
      const fromInMl = qty * VOLUME_TO_ML[normFrom];
      const converted = fromInMl / MASS_TO_GRAM[normTo];
      return { possible: true, converted };
    }
  }

  // 2. Resolve piece weight for Mass <-> Count conversions
  const pieceWeight = options?.pieceWeightGrams || (
    options?.conversionFactor && (
      (options.baseUnit && normalizeUnit(options.baseUnit) === 'pcs' && (!options.secondaryUnit || normalizeUnit(options.secondaryUnit) === 'g')) ||
      (!options.baseUnit && (normFrom === 'pcs' || normTo === 'pcs') && (dimFrom === 'MASS' || dimTo === 'MASS'))
    ) ? options.conversionFactor : undefined
  );

  // 3. Metadata-driven Packaging unit conversions
  if (options?.packagingUnits && options.packagingUnits.length > 0) {
    const packFrom = options.packagingUnits.find(p => normalizeUnit(p.packUnit) === normFrom);
    const packTo = options.packagingUnits.find(p => normalizeUnit(p.packUnit) === normTo);

    // a) From packaging unit to count (base units)
    if (packFrom && normTo === 'pcs') {
      return { possible: true, converted: qty * packFrom.packSize };
    }
    // b) From count (base units) to packaging unit
    if (packTo && normFrom === 'pcs') {
      return { possible: true, converted: qty / packTo.packSize };
    }
    // c) From packaging unit to mass (e.g. pkt -> g or kg)
    if (packFrom && dimTo === 'MASS' && pieceWeight && pieceWeight > 0) {
      const totalGrams = qty * packFrom.packSize * pieceWeight;
      return { possible: true, converted: totalGrams / MASS_TO_GRAM[normTo] };
    }
    // d) From mass to packaging unit (e.g. kg or g -> pkt)
    if (packTo && dimFrom === 'MASS' && pieceWeight && pieceWeight > 0) {
      const fromInGrams = qty * MASS_TO_GRAM[normFrom];
      const totalPieces = fromInGrams / pieceWeight;
      return { possible: true, converted: totalPieces / packTo.packSize };
    }
    // e) Between two packaging units (e.g. kg pack to pkt pack)
    if (packFrom && packTo) {
      const pieces = qty * packFrom.packSize;
      return { possible: true, converted: pieces / packTo.packSize };
    }
  }

  // 4. Metadata-driven Mass <-> Count conversion
  if ((dimFrom === 'MASS' && dimTo === 'COUNT') || (dimFrom === 'COUNT' && dimTo === 'MASS')) {
    if (pieceWeight && pieceWeight > 0) {
      if (dimFrom === 'MASS' && dimTo === 'COUNT') {
        const fromInGrams = qty * MASS_TO_GRAM[normFrom];
        const converted = fromInGrams / pieceWeight;
        return { possible: true, converted };
      } else {
        const grams = qty * pieceWeight;
        const converted = grams / MASS_TO_GRAM[normTo];
        return { possible: true, converted };
      }
    }
    return {
      possible: false,
      error: `Cannot convert between mass ('${fromUnit}') and count ('${toUnit}') without configured piece weight (conversion_factor).`,
    };
  }

  // 5. Incompatible dimensions
  if (dimFrom !== dimTo) {
    return {
      possible: false,
      error: `Cannot convert across different dimensions (${dimFrom} to ${dimTo}): '${fromUnit}' and '${toUnit}'.`,
    };
  }

  // 6. Intra-dimension MASS conversion
  if (dimFrom === 'MASS') {
    const fromInGrams = qty * MASS_TO_GRAM[normFrom];
    const converted = fromInGrams / MASS_TO_GRAM[normTo];
    return { possible: true, converted };
  }

  // 7. Intra-dimension VOLUME conversion
  if (dimFrom === 'VOLUME') {
    const fromInMl = qty * VOLUME_TO_ML[normFrom];
    const converted = fromInMl / VOLUME_TO_ML[normTo];
    return { possible: true, converted };
  }

  // 8. Intra-dimension COUNT conversion
  if (dimFrom === 'COUNT') {
    return { possible: true, converted: qty };
  }

  return {
    possible: false,
    error: `Incompatible container units without packaging conversion: '${fromUnit}' and '${toUnit}'.`,
  };
}

/**
 * Checks whether a proposed unit is compatible with an ingredient's base unit.
 */
export function isUnitCompatibleWithIngredient(
  proposedUnit: string,
  baseUnitSymbol: string | null | undefined,
  options?: UnitConversionOptions
): boolean {
  if (!proposedUnit || !baseUnitSymbol) return false;
  return areUnitsCompatible(proposedUnit, baseUnitSymbol, options);
}

/**
 * Derives dynamic, context-sensitive unit options for an ingredient.
 * Derives strictly from active central units in public.units and conversion engine capabilities.
 */
export function getCompatibleUnitOptions(
  baseUnitSymbol: string | null | undefined,
  centralUnits?: CentralUnit[],
  options?: UnitConversionOptions,
  locale: 'en' | 'hi' = 'en'
): UnitOption[] {
  const normBase = normalizeUnit(baseUnitSymbol);
  const baseDim = normBase ? getUnitDimension(normBase) : 'UNKNOWN';

  const seenSymbols = new Set<string>();
  const results: UnitOption[] = [];

  const addOption = (value: string, label: string, dimension?: Dimension) => {
    const norm = normalizeUnit(value);
    if (!seenSymbols.has(norm)) {
      seenSymbols.add(norm);
      results.push({ value, label, dimension });
    }
  };

  // If central units master list is supplied, filter active and compatible
  if (centralUnits && centralUnits.length > 0) {
    const activeUnits = centralUnits.filter(u => u.is_active !== false);

    for (const u of activeUnits) {
      if (!normBase || areUnitsCompatible(u.symbol, normBase, options)) {
        const displaySymbol = u.symbol === 'kg' ? 'Kg' : (locale === 'hi' && u.symbol_hi ? u.symbol_hi : u.symbol);
        const displayName = locale === 'hi' && u.name_hi ? u.name_hi : u.name;
        const label = `${displaySymbol} (${displayName})`;
        addOption(u.symbol, label, getUnitDimension(u.symbol));
      }
    }
  } else {
    // Fallback: derive from engine dimensions if central master is omitted
    if (baseDim === 'MASS' || baseDim === 'VOLUME' || !normBase) {
      addOption('kg', locale === 'hi' ? 'Kg (किलोग्राम)' : 'Kg (Kilogram)', 'MASS');
      addOption('g', locale === 'hi' ? 'g (ग्राम)' : 'g (Gram)', 'MASS');
      addOption('mg', locale === 'hi' ? 'mg (मिलीग्राम)' : 'mg (Milligram)', 'MASS');
    }
    if (baseDim === 'VOLUME' || baseDim === 'MASS' || !normBase) {
      addOption('L', locale === 'hi' ? 'L (लीटर)' : 'L (Liter)', 'VOLUME');
      addOption('ml', locale === 'hi' ? 'ml (मिलीलीटर)' : 'ml (Milliliter)', 'VOLUME');
    }
    if (baseDim === 'COUNT' || !normBase) {
      addOption('pcs', locale === 'hi' ? 'pcs (पीस)' : 'pcs (Pieces)', 'COUNT');
    }
  }

  // Engine special culinary unit: chutki (pinch = 0.36g) for mass-compatible items
  if (baseDim === 'MASS' || (normBase && areUnitsCompatible('chutki', normBase, options))) {
    const chutkiLabel = locale === 'hi' ? 'चुटकी (chutki ~0.36g)' : 'chutki (Pinch ~0.36g)';
    addOption('chutki', chutkiLabel, 'MASS');
  }

  // Packaging units from item metadata
  if (options?.packagingUnits && options.packagingUnits.length > 0) {
    for (const pkg of options.packagingUnits) {
      if (areUnitsCompatible(pkg.packUnit, normBase || 'pcs', options)) {
        addOption(pkg.packUnit, `${pkg.packUnit} (${pkg.packSize} ${normBase || 'base'})`, 'CONTAINER');
      }
    }
  }

  return results;
}

