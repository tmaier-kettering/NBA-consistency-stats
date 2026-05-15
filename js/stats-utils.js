/**
 * NBA Consistency Stats — stats-utils.js
 * Shared statistical helper functions used across multiple pages.
 */

'use strict';

/**
 * Approximate error function using Abramowitz & Stegun 7.1.26.
 * @param {number} x Input value.
 * @returns {number} Approximate erf(x).
 */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));
  return sign * y;
}

/**
 * Cumulative distribution function of the normal distribution.
 * @param {number} x Value to evaluate.
 * @param {number} mean Distribution mean.
 * @param {number} std  Distribution standard deviation (must be > 0).
 * @returns {number} P(X ≤ x) under N(mean, std²).
 */
function normalCdf(x, mean, std) {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(std) || std <= 0) {
    if (x < mean) return 0;
    if (x > mean) return 1;
    return 0.5;
  }
  const z = (x - mean) / (std * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

/**
 * Compute expected histogram counts under a skew-normal distribution fitted
 * to the supplied values using their sample mean, standard deviation, and
 * skewness.  When skewness is negligible the result reduces to a symmetric
 * normal trendline.
 *
 * The skew-normal shape parameter α is estimated from the sample skewness γ₁
 * via the moment-matching approximation:
 *   δ² = (π/2) · |γ₁|^(2/3) / (|γ₁|^(2/3) + ((4−π)/2)^(2/3))
 *   α  = δ / √(1 − δ²)
 * Skewness is clamped to ±0.99 because the maximum achievable skewness of a
 * skew-normal distribution is ≈ ±0.9952; exceeding this value would make the
 * moment-matching solution numerically unstable or imaginary.
 *
 * @param {number[]|null} values Observed game-log values.
 * @param {Array<{x0:number,x1:number,count:number}>|null} bins Histogram bins.
 * @returns {number[]} Expected counts per bin for the trendline.
 */
function computeNormalTrendline(values, bins) {
  if (!values?.length || !bins?.length) return [];
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std <= 0) return [];

  const skew = n >= 3
    ? values.reduce((s, v) => s + ((v - mean) / std) ** 3, 0) / n
    : 0;

  // Maximum achievable skewness for a skew-normal distribution is ≈ ±0.9952.
  // Clamping to ±0.99 keeps the moment-matching approximation numerically stable.
  const MAX_SKEW = 0.99;
  const g = Math.max(-MAX_SKEW, Math.min(MAX_SKEW, skew));
  let xi = mean, omega = std, alpha = 0;
  if (Math.abs(g) >= 1e-6) {
    const c = (4 - Math.PI) / 2;
    const a23 = Math.abs(g) ** (2 / 3);
    const c23 = c ** (2 / 3);
    const delta2 = (Math.PI / 2) * a23 / (a23 + c23);
    const delta = Math.sign(g) * Math.sqrt(delta2);
    alpha = delta / Math.sqrt(1 - delta2);
    const b = delta * Math.sqrt(2 / Math.PI);
    omega = std / Math.sqrt(1 - b * b);
    xi = mean - omega * b;
  }

  return bins.map(bin => {
    const mid = (bin.x0 + bin.x1) / 2;
    const width = bin.x1 - bin.x0;
    const z = (mid - xi) / omega;
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const bigPhi = normalCdf(alpha * z, 0, 1);
    return Math.max(0, (2 / omega) * phi * bigPhi * width * n);
  });
}
