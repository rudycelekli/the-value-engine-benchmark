/** Scenario loading & validation. */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { Scenario } from '../types.js';
import { ALL_EVENT_EFFECTS, asExtendedEvent } from './events.js';

const GATE_KINDS = new Set([
  'quantifying_question',
  'process_question',
  'champion_test',
  'eb_meeting_held',
  'trust_threshold',
  'competitor_probe',
  'map_proposed',
]);

export function loadScenario(idOrPath: string, scenarioDir: string): Scenario {
  let file: string;
  if (idOrPath.endsWith('.yaml') || idOrPath.endsWith('.yml')) {
    file = resolve(idOrPath);
  } else {
    const match = readdirSync(scenarioDir).find((f) => {
      if (!/\.ya?ml$/.test(f)) return false;
      const doc = parse(readFileSync(join(scenarioDir, f), 'utf8')) as { id?: string };
      return doc?.id === idOrPath;
    });
    if (!match) throw new Error(`Scenario '${idOrPath}' not found in ${scenarioDir}`);
    file = join(scenarioDir, match);
  }
  const s = parse(readFileSync(file, 'utf8')) as Scenario;
  validateScenario(s);
  return s;
}

export function listScenarios(scenarioDir: string): Scenario[] {
  return readdirSync(scenarioDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => parse(readFileSync(join(scenarioDir, f), 'utf8')) as Scenario)
    .sort((a, b) => a.difficulty - b.difficulty);
}

export function validateScenario(s: Scenario): void {
  const problems: string[] = [];
  if (!s.id) problems.push('missing id');
  if (!s.personas?.length) problems.push('no personas');
  if (!s.personas?.some((p) => p.is_economic_buyer)) problems.push('no economic buyer persona');
  if (!s.personas?.some((p) => p.is_initial_contact)) problems.push('no initial contact persona');
  if (!s.calendar?.weeks || !s.calendar?.slots_per_week) problems.push('invalid calendar');
  for (const gf of s.gated_facts ?? []) {
    if (!GATE_KINDS.has(gf.gate)) problems.push(`gated fact '${gf.id}' has unknown gate '${gf.gate}'`);
    if (gf.gate === 'trust_threshold' && typeof gf.trust_min !== 'number') {
      problems.push(`gated fact '${gf.id}' uses trust_threshold without trust_min`);
    }
  }
  const factIds = new Set((s.gated_facts ?? []).map((f) => f.id));
  for (const req of s.win_conditions?.required_facts ?? []) {
    if (!factIds.has(req)) problems.push(`win condition requires unknown fact '${req}'`);
  }
  // v3: extended event schema (all optional fields; v1 events pass unchanged).
  for (const ev of s.events ?? []) {
    const x = asExtendedEvent(ev);
    if (!ALL_EVENT_EFFECTS.has(String(x.effect))) {
      problems.push(`event '${ev.id}' has unknown effect '${x.effect}'`);
      continue;
    }
    if (x.effect === 'internal_pressure' && !(x.seller_message || ev.description)) {
      problems.push(`event '${ev.id}' (internal_pressure) needs a seller_message or description`);
    }
    if (x.effect === 'champion_departure' && x.successor && !x.successor.id) {
      problems.push(`event '${ev.id}' (champion_departure) successor persona is missing an id`);
    }
    if (x.effect === 'reorg' && x.new_eb && !x.new_eb.id) {
      problems.push(`event '${ev.id}' (reorg) new_eb persona is missing an id`);
    }
  }
  if (problems.length) throw new Error(`Scenario '${s.id ?? '?'}' invalid: ${problems.join('; ')}`);
}
