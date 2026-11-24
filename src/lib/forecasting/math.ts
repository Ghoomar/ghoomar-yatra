/**
 * Mathematical Foundations for Dual-Track Sales & Volume Forecasting
 * Independent Track Learning: Revenue Track (rev_*) vs. Quantity Track (qty_*)
 */

export interface TrackUpdateInput {
  baseline: number;
  predicted: number;
  actual_normal: number;
  actual_total: number;
  prior_smoothed_signed_error: number;
  prior_smoothed_abs_error: number;
  prior_wape: number;
  prior_error_std: number;
}

export interface TrackUpdateResult {
  updated_baseline: number;
  error: number;
  signed_error_pct: number;
  abs_error_pct: number;
  smoothed_signed_error: number;
  smoothed_abs_error: number;
  tracking_signal: number;
  signed_bias_pct: number;
  applied_bias_pct: number;
  adaptive_alpha: number;
  recent_wape: number;
  error_std: number;
  confidence_score: number;
  was_outlier_dampened: boolean;
}

/**
 * Clamps a number to [min, max].
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/**
 * Rounds a number to specified decimal places.
 */
export function round(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Computes single-step EWMA update for a track (Quantity or Revenue) independently.
 */
export function computeTrackUpdate(input: TrackUpdateInput): TrackUpdateResult {
  const {
    baseline,
    predicted,
    actual_normal,
    prior_smoothed_signed_error,
    prior_smoothed_abs_error,
    prior_wape,
  } = input;

  const P = Math.max(1.0, predicted);
  const A_norm = Math.max(0, actual_normal);
  const raw_error = actual_normal - predicted;

  const signed_error_pct = (raw_error / P) * 100;
  const abs_error_pct = (Math.abs(raw_error) / P) * 100;

  // Outlier detection (> 40% deviation from prediction)
  let effective_actual = A_norm;
  let was_outlier_dampened = false;
  if (Math.abs(raw_error) / P > 0.40) {
    const sign = raw_error >= 0 ? 1 : -1;
    effective_actual = P + sign * 0.40 * P;
    was_outlier_dampened = true;
  }

  const effective_error = effective_actual - predicted;

  // Smoothed errors (0.25 fresh / 0.75 persistent memory)
  const smoothed_signed_error = 0.25 * effective_error + 0.75 * prior_smoothed_signed_error;
  const smoothed_abs_error = 0.25 * Math.abs(effective_error) + 0.75 * prior_smoothed_abs_error;

  // Tracking signal TS in [0, 1]
  const denom = Math.max(smoothed_abs_error, 1.0);
  const tracking_signal = clamp(Math.abs(smoothed_signed_error) / denom, 0.0, 1.0);

  // Adaptive alpha between 0.20 and 0.65
  // Accelerates when tracking signal or error magnitude is elevated
  const errorRatio = Math.min(1.0, Math.abs(effective_error) / (0.35 * P));
  const rawAlpha = 0.20 + 0.45 * (0.65 * tracking_signal + 0.35 * errorRatio);
  const adaptive_alpha = clamp(rawAlpha, 0.20, 0.65);

  // Signed bias & Applied bias (clamped to [-15%, +15%])
  const signed_bias_pct = (smoothed_signed_error / P) * 100;
  const applied_bias_pct = clamp(0.50 * signed_bias_pct, -15.0, 15.0);

  // Baseline update using adaptive alpha and damped normal demand
  const updated_baseline = (1 - adaptive_alpha) * baseline + adaptive_alpha * effective_actual;

  // Rolling WAPE (0.30 fresh error / 0.70 historical)
  const current_wape = Math.abs(raw_error) / P;
  const recent_wape = 0.30 * current_wape + 0.70 * prior_wape;

  // Standard deviation approximation
  const error_std = Math.sqrt(0.30 * Math.pow(current_wape - recent_wape, 2) + 0.70 * Math.pow(input.prior_error_std, 2));

  // Confidence score calculation (30 to 95)
  // Penalizes high WAPE and tracking signal instability
  const rawConfidence = 100.0 - (recent_wape * 100.0 * 1.20) - (tracking_signal * 15.0);
  const confidence_score = clamp(rawConfidence, 30.0, 95.0);

  return {
    updated_baseline: round(updated_baseline, 2),
    error: round(raw_error, 2),
    signed_error_pct: round(signed_error_pct, 2),
    abs_error_pct: round(abs_error_pct, 2),
    smoothed_signed_error: round(smoothed_signed_error, 2),
    smoothed_abs_error: round(smoothed_abs_error, 2),
    tracking_signal: round(tracking_signal, 3),
    signed_bias_pct: round(signed_bias_pct, 2),
    applied_bias_pct: round(applied_bias_pct, 2),
    adaptive_alpha: round(adaptive_alpha, 3),
    recent_wape: round(recent_wape, 4),
    error_std: round(error_std, 4),
    confidence_score: round(confidence_score, 2),
    was_outlier_dampened,
  };
}

/**
 * Computes Weighted Absolute Percentage Error (WAPE) across dish quantities.
 */
export function computeDishWape(
  predictedDishes: Array<{ dish_name: string; predicted_quantity: number }>,
  actualDishes: Array<{ dish_name: string; quantity: number }>
): number {
  const actualMap = new Map<string, number>();
  let totalActual = 0;
  for (const a of actualDishes) {
    actualMap.set(a.dish_name, (actualMap.get(a.dish_name) || 0) + a.quantity);
    totalActual += a.quantity;
  }

  const allDishNames = new Set<string>([
    ...predictedDishes.map((p) => p.dish_name),
    ...actualDishes.map((a) => a.dish_name),
  ]);

  let sumAbsDelta = 0;
  for (const name of allDishNames) {
    const pQty = predictedDishes.find((p) => p.dish_name === name)?.predicted_quantity || 0;
    const aQty = actualMap.get(name) || 0;
    sumAbsDelta += Math.abs(aQty - pQty);
  }

  if (totalActual === 0) return 0;
  return round(sumAbsDelta / totalActual, 4);
}

/**
 * Calculates prediction bounds [low, high] based on confidence score and recent error std.
 */
export function calculatePredictionBounds(
  prediction: number,
  confidenceScore: number,
  recentWape: number
): { low: number; high: number } {
  // Higher confidence narrows the bounds; lower confidence widens them
  const marginPct = clamp(Math.max(0.08, recentWape * 1.35) * (1 - (confidenceScore - 50) / 100), 0.08, 0.35);
  return {
    low: round(Math.max(0, prediction * (1 - marginPct)), 2),
    high: round(prediction * (1 + marginPct), 2),
  };
}

/**
 * Resolves confidence tier label.
 */
export function getConfidenceTier(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 75) return 'High';
  if (score >= 55) return 'Medium';
  return 'Low';
}
