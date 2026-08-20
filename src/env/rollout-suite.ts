/**
 * The budget-capped rollout suite: sweep environments × models × seeds, grade
 * each into a RolloutDatapoint, append it to dataset.jsonl (SWE-bench/tbench
 * standard, one JSON per line — the full trajectory is the product), and derive
 * the empirical difficulty leaderboard (which real models actually clear each
 * env's bar). Runs strictly sequentially so the dollar guard is honest.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Scenario } from '../types.js';
import { runFrontierRollout, type RolloutDatapoint } from './rollout.js';
import { benchmarkVersion } from './dataset.js';
import { buyerSimVersion } from './buyer-sim.js';

export interface RolloutCell {
  env: string;
  model: string; // seller spec
  pack: boolean;
  seed: number;
  reward: number;
  resolved: boolean;
  cleared_bar: boolean;
  cost_usd: number;
  format_retries: number;
}
export interface ModelLeaderRow {
  model: string;
  runs: number;
  mean_reward: number;
  clear_rate: number; // fraction with reward >= ORACLE_MIN
  win_rate: number; // fraction resolved
  total_cost_usd: number;
}
export interface EnvDifficultyRow {
  env: string;
  runs: number;
  mean_reward: number;
  best_reward: number;
  solved_by: string[]; // models that cleared the bar at least once
  empirically_solved: boolean;
}
/** A cell that could not be turned into a datapoint after retries. Recorded so
 * one transient network blip never aborts the whole sweep — the cell is skipped
 * and can be re-run later, not silently lost. */
export interface RolloutErrorCell {
  env: string;
  model: string; // seller spec
  seed: number;
  attempts: number;
  error: string;
}
export interface RolloutSuiteReport {
  generated_at: string;
  benchmark_version: string;
  buyer_sim: string;
  git: { sha: string; dirty: boolean };
  budget_usd: number;
  spent_usd: number;
  datapoints: number;
  stopped_on_budget: boolean;
  errored: number;
  errors: RolloutErrorCell[];
  cells: RolloutCell[];
  leaderboard: ModelLeaderRow[];
  env_difficulty: EnvDifficultyRow[];
}
export interface RolloutSuiteOptions {
  scenarios: Scenario[];
  sellerSpecs: string[];
  seeds: number[];
  pack: boolean;
  runsDir: string;
  budgetUsd: number;
  datasetPath: string;
  mock: boolean;
  /** Root for per-cell buyer transcript dirs when NOT mock. */
  transcriptRoot?: string;
  generatedAt?: string;
  /**
   * When set, the full report is flushed to this path after every cell (success
   * or error), so a hard crash mid-sweep still leaves a valid partial report on
   * disk — completed datapoints are never thrown away. The caller may also write
   * the returned report at the end; both are idempotent full snapshots.
   */
  reportPath?: string;
  /**
   * Max RETRIES (not attempts) for a cell whose rollout throws a transient
   * network error (fetch failed, ECONNRESET, 429/5xx, timeout, overloaded).
   * Non-transient errors are recorded immediately without retry. Default 3.
   */
  maxRetries?: number;
  /**
   * Max rollouts in flight (default 1 = sequential). Concurrency fans out ACROSS
   * distinct seller specs only: each spec owns a lane processed sequentially, so
   * two in-flight rollouts never share a spec. That keeps the per-spec
   * `formatRetries` delta clean and `withUsageScope` (AsyncLocalStorage) already
   * isolates per-rollout cost. Effective parallelism = min(concurrency, #specs).
   */
  concurrency?: number;
  /**
   * Resume an interrupted sweep instead of starting fresh. When true and
   * `datasetPath` already exists, every persisted cell — keyed by
   * (scenario_id, seller spec, seed) — is skipped, its cost is folded into the
   * running budget total, and its record is carried into the final report. The
   * dataset file is APPENDED to (never truncated), so prior work is preserved
   * byte-for-byte. Default false (fresh run: truncate then rebuild).
   */
  resume?: boolean;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Flatten an error (and its `cause`, which Node's `fetch failed` wraps) to a
 * message string for logging and transient classification. */
function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : '';
    return causeMsg ? `${err.message} (cause: ${causeMsg})` : err.message;
  }
  return String(err);
}

// Network/provider hiccups worth retrying. Anything else (a real bug, a bad
// scenario) is recorded immediately so we don't burn money retrying a
// deterministic failure.
const TRANSIENT_ERROR =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout|timed out|rate.?limit|overloaded|too many requests|\b(429|500|502|503|504)\b|service unavailable|bad gateway|gateway timeout/i;

function isTransient(err: unknown): boolean {
  return TRANSIENT_ERROR.test(errMessage(err));
}

type RolloutAttempt<T> = { ok: true; value: T } | { ok: false; error: string; attempts: number };

/** Run `fn`, retrying only on transient errors with exponential backoff (capped
 * at 30s). Returns a tagged result instead of throwing, so the caller's sweep
 * loop can record the failure and carry on. */
async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry: (attempt: number, backoffMs: number, message: string) => void,
): Promise<RolloutAttempt<T>> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      const message = errMessage(err);
      if (attempt > maxRetries || !isTransient(err)) {
        return { ok: false, error: message, attempts: attempt };
      }
      const backoffMs = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      onRetry(attempt, backoffMs, message);
      await sleep(backoffMs);
    }
  }
}

function buildLeaderboard(cells: RolloutCell[]): ModelLeaderRow[] {
  const byModel = new Map<string, RolloutCell[]>();
  for (const c of cells) (byModel.get(c.model) ?? byModel.set(c.model, []).get(c.model)!).push(c);
  return [...byModel.entries()]
    .map(([model, cs]) => ({
      model,
      runs: cs.length,
      mean_reward: round(mean(cs.map((c) => c.reward))),
      clear_rate: round(cs.filter((c) => c.cleared_bar).length / cs.length),
      win_rate: round(cs.filter((c) => c.resolved).length / cs.length),
      total_cost_usd: round(cs.reduce((a, c) => a + c.cost_usd, 0)),
    }))
    .sort((a, b) => b.mean_reward - a.mean_reward);
}

function buildEnvDifficulty(cells: RolloutCell[]): EnvDifficultyRow[] {
  const byEnv = new Map<string, RolloutCell[]>();
  for (const c of cells) (byEnv.get(c.env) ?? byEnv.set(c.env, []).get(c.env)!).push(c);
  return [...byEnv.entries()].map(([env, cs]) => {
    const solvers = [...new Set(cs.filter((c) => c.cleared_bar).map((c) => c.model))];
    return {
      env,
      runs: cs.length,
      mean_reward: round(mean(cs.map((c) => c.reward))),
      best_reward: round(Math.max(...cs.map((c) => c.reward))),
      solved_by: solvers,
      empirically_solved: solvers.length > 0,
    };
  });
}

export async function runRolloutSuite(opts: RolloutSuiteOptions): Promise<RolloutSuiteReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  mkdirSync(dirname(opts.datasetPath), { recursive: true });
  if (opts.reportPath) mkdirSync(dirname(opts.reportPath), { recursive: true });
  const maxRetries = Math.max(0, opts.maxRetries ?? 3);

  const cells: RolloutCell[] = [];
  const errors: RolloutErrorCell[] = [];
  let spent = 0;
  let stopped = false;
  let git: { sha: string; dirty: boolean } = { sha: 'unknown', dirty: false };

  // A cell is uniquely identified by (scenario, seller spec, seed). NUL joins so
  // no id can smuggle a delimiter and forge a collision.
  const cellKey = (scenario: string, spec: string, seed: number): string =>
    `${scenario}\u0000${spec}\u0000${seed}`;

  // Resume: fold every already-persisted cell into the running state and skip it
  // below, appending only new work. Fresh run: truncate and rebuild from zero.
  const done = new Set<string>();
  if (opts.resume && existsSync(opts.datasetPath)) {
    for (const line of readFileSync(opts.datasetPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const dp = JSON.parse(trimmed) as RolloutDatapoint;
      done.add(cellKey(dp.env.scenario_id, dp.model.spec, dp.seed));
      spent += dp.cost.usd;
      git = dp.provenance.git;
      cells.push({
        env: dp.env.scenario_id,
        model: dp.model.spec,
        pack: opts.pack,
        seed: dp.seed,
        reward: dp.reward,
        resolved: dp.resolved,
        cleared_bar: dp.cleared_bar,
        cost_usd: round(dp.cost.usd),
        format_retries: dp.format_retries,
      });
    }
  } else {
    writeFileSync(opts.datasetPath, '', 'utf8'); // fresh dataset per suite run
  }

  const snapshot = (): RolloutSuiteReport => ({
    generated_at: generatedAt,
    benchmark_version: benchmarkVersion(),
    buyer_sim: buyerSimVersion(),
    git,
    budget_usd: opts.budgetUsd,
    spent_usd: round(spent),
    datapoints: cells.length,
    stopped_on_budget: stopped,
    errored: errors.length,
    errors,
    cells,
    leaderboard: buildLeaderboard(cells),
    env_difficulty: buildEnvDifficulty(cells),
  });
  // Flush a full snapshot after every cell so a hard crash can't discard work.
  // JS is single-threaded and there is no await between build and write, so
  // concurrent lanes can't interleave a single flush; last-writer-wins is fine
  // because every snapshot is a complete, valid report.
  const flush = (): void => {
    if (opts.reportPath) writeFileSync(opts.reportPath, `${JSON.stringify(snapshot(), null, 2)}\n`, 'utf8');
  };

  // One lane per seller spec. All of a spec's jobs (scenarios × seeds) run
  // sequentially inside its lane; lanes run in parallel up to `concurrency`.
  // This guarantees two in-flight rollouts never share a spec, so the per-spec
  // `formatRetries` delta captured in runFrontierRollout stays uncontaminated.
  interface Job {
    scenario: Scenario;
    seed: number;
  }
  const lanes: { spec: string; jobs: Job[] }[] = opts.sellerSpecs.map((spec) => ({
    spec,
    jobs: opts.scenarios.flatMap((scenario) => opts.seeds.map((seed) => ({ scenario, seed }))),
  }));

  let nextLane = 0;
  async function worker(): Promise<void> {
    while (nextLane < lanes.length) {
      const lane = lanes[nextLane++];
      for (const job of lane.jobs) {
        // Resume skip: this cell is already persisted; keep it, don't re-run.
        if (done.has(cellKey(job.scenario.id, lane.spec, job.seed))) continue;
        // Budget guard: JS is single-threaded, so this check-then-reserve is
        // race-free between awaits. Worst-case overshoot ≤ in-flight lanes.
        if (spent >= opts.budgetUsd) {
          stopped = true;
          break; // stop this lane; other lanes will trip the same guard
        }
        const transcriptDir =
          opts.transcriptRoot && !opts.mock
            ? `${opts.transcriptRoot}/${job.scenario.id}/${lane.spec.replace(/[:/]/g, '_')}/s${job.seed}`
            : undefined;

        const label = `${job.scenario.id}·${lane.spec}·s${job.seed}`;
        const attempt = await runWithRetry<RolloutDatapoint>(
          () =>
            runFrontierRollout({
              scenario: job.scenario,
              sellerSpec: lane.spec,
              pack: opts.pack,
              seed: job.seed,
              runsDir: opts.runsDir,
              mock: opts.mock,
              transcriptDir,
              generatedAt,
            }),
          maxRetries,
          (n, backoffMs, message) =>
            console.warn(`[rollout] transient error on ${label} (attempt ${n}), retrying in ${backoffMs}ms: ${message}`),
        );

        // A single failed cell is recorded and skipped — it must never abort the
        // sweep, or one blip discards every other lane's in-flight work.
        if (!attempt.ok) {
          console.error(`[rollout] FAILED ${label} after ${attempt.attempts} attempt(s): ${attempt.error}`);
          errors.push({ env: job.scenario.id, model: lane.spec, seed: job.seed, attempts: attempt.attempts, error: attempt.error });
          flush();
          continue;
        }

        const dp = attempt.value;
        appendFileSync(opts.datasetPath, `${JSON.stringify(dp)}\n`, 'utf8');
        spent += dp.cost.usd;
        git = dp.provenance.git;
        cells.push({
          env: dp.env.scenario_id,
          model: lane.spec,
          pack: opts.pack,
          seed: job.seed,
          reward: dp.reward,
          resolved: dp.resolved,
          cleared_bar: dp.cleared_bar,
          cost_usd: round(dp.cost.usd),
          format_retries: dp.format_retries,
        });
        flush();
      }
    }
  }

  const workerCount = Math.max(1, Math.min(opts.concurrency ?? 1, lanes.length));
  // Workers never throw now (every rollout error is caught and recorded), so a
  // failing lane can't reject Promise.all and tear down its siblings.
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const report = snapshot();
  flush();
  return report;
}
