/**
 * Shared, dependency-free statistics — the single source of truth for both the
 * exploratory analytics pipeline (src/analytics/) and the publication dataset
 * pipeline (src/dataset/).
 *
 * Guardrails: every consumer carries group sizes; anything with n < MIN_GROUP_N
 * per group is flagged 'insufficient-n'; no lift is reported without a CI. The
 * bootstrap is seeded (deterministic LCG) so every run is byte-reproducible.
 */

// ---------------------------------------------------------------------------
// Basic stats (no deps)
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Point-biserial correlation between a binary group label and a continuous feature. */
export function pointBiserial(groups: number[], values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const g1 = values.filter((_, i) => groups[i] === 1);
  const g0 = values.filter((_, i) => groups[i] === 0);
  if (!g1.length || !g0.length) return 0;
  const sAll = std(values);
  if (sAll === 0) return 0;
  const p = g1.length / n;
  return ((mean(g1) - mean(g0)) / sAll) * Math.sqrt(p * (1 - p) * (n / (n - 1)));
}

/** Deterministic LCG so analytics and dataset runs are reproducible. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface BootstrapCI {
  lo: number;
  hi: number;
}

/** Percentile-bootstrap 95% CI on the mean difference (g1 − g0). */
export function bootstrapLiftCI(g1: number[], g0: number[], iters = 1000, seed = 42): BootstrapCI {
  const rng = makeRng(seed);
  const resample = (xs: number[]) => {
    const out = new Array<number>(xs.length);
    for (let i = 0; i < xs.length; i++) out[i] = xs[Math.floor(rng() * xs.length)];
    return out;
  };
  const diffs: number[] = [];
  for (let i = 0; i < iters; i++) diffs.push(mean(resample(g1)) - mean(resample(g0)));
  diffs.sort((a, b) => a - b);
  return { lo: diffs[Math.floor(iters * 0.025)], hi: diffs[Math.ceil(iters * 0.975) - 1] };
}

/** Percentile-bootstrap 95% CI on a single group's mean. */
export function bootstrapMeanCI(xs: number[], iters = 1000, seed = 42): BootstrapCI {
  if (!xs.length) return { lo: NaN, hi: NaN };
  const rng = makeRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(rng() * xs.length)];
    means.push(sum / xs.length);
  }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(iters * 0.025)], hi: means[Math.ceil(iters * 0.975) - 1] };
}

/**
 * Paired percentile-bootstrap 95% CI on the mean of within-pair differences.
 * `pairs[i] = [treatment, control]`; resamples pairs (not the two arms
 * independently) so the pairing structure is preserved.
 */
export function bootstrapPairedCI(pairs: Array<[number, number]>, iters = 1000, seed = 42): BootstrapCI {
  if (!pairs.length) return { lo: NaN, hi: NaN };
  const rng = makeRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < pairs.length; j++) {
      const p = pairs[Math.floor(rng() * pairs.length)];
      sum += p[0] - p[1];
    }
    means.push(sum / pairs.length);
  }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(iters * 0.025)], hi: means[Math.ceil(iters * 0.975) - 1] };
}

/** Minimum per-group sample size before a comparison is trusted. */
export const MIN_GROUP_N = 10;
