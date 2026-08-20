/**
 * Deterministic milestone verifier — the PRIMARY, non-hackable reward signal.
 * Reads only the deterministic BuyerState.finalState the state machine already
 * produced (releasedFactIds, trust, ebMeetingHeld, mapAcknowledged,
 * discountConcededPct) against the scenario's WinConditions. Same fields
 * BuyerStateMachine.checkTerminal() uses to decide `won`, exposed as a graded
 * per-milestone vector so RL rollouts get partial credit.
 */
import type { BuyerState, WinConditions } from '../types.js';

export interface Milestone {
  id: 'facts' | 'trust' | 'eb' | 'map' | 'price';
  label: string;
  met: boolean;
  score: number; // 0..1
  weight: number;
  detail: string;
}

export interface MilestoneResult {
  milestones: Milestone[];
  milestonePartial: number; // weighted 0..1
  allMet: boolean;
}

export const MILESTONE_WEIGHTS: Record<Milestone['id'], number> = {
  facts: 0.4,
  trust: 0.2,
  eb: 0.15,
  map: 0.15,
  price: 0.1,
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function computeMilestones(state: BuyerState, wc: WinConditions): MilestoneResult {
  const released = new Set(state.releasedFactIds);
  const earned = wc.required_facts.filter((f) => released.has(f)).length;
  const factsScore = wc.required_facts.length === 0 ? 1 : earned / wc.required_facts.length;

  const trustScore = wc.min_trust <= 0 ? 1 : clamp01(state.trust / wc.min_trust);

  const ebScore = wc.requires_eb_meeting ? (state.ebMeetingHeld ? 1 : 0) : 1;
  const mapScore = wc.requires_map ? (state.mapAcknowledged ? 1 : 0) : 1;

  const over = state.discountConcededPct - wc.max_discount_pct;
  const priceScore =
    over <= 0 ? 1 : wc.max_discount_pct <= 0 ? 0 : clamp01(1 - over / wc.max_discount_pct);

  const raw: Array<Omit<Milestone, 'weight'>> = [
    { id: 'facts', label: 'Required facts earned', met: factsScore === 1, score: round(factsScore), detail: `${earned}/${wc.required_facts.length} required facts released` },
    { id: 'trust', label: 'Trust threshold', met: state.trust >= wc.min_trust, score: round(trustScore), detail: `trust ${state.trust}/${wc.min_trust}` },
    { id: 'eb', label: 'Economic-buyer meeting', met: ebScore === 1, score: ebScore, detail: wc.requires_eb_meeting ? (state.ebMeetingHeld ? 'EB met' : 'EB never met') : 'not required' },
    { id: 'map', label: 'Mutual action plan', met: mapScore === 1, score: mapScore, detail: wc.requires_map ? (state.mapAcknowledged ? 'MAP acknowledged' : 'no acknowledged MAP') : 'not required' },
    { id: 'price', label: 'Price integrity', met: state.discountConcededPct <= wc.max_discount_pct, score: round(priceScore), detail: `discount ${state.discountConcededPct}% vs tolerance ${wc.max_discount_pct}%` },
  ];

  const milestones: Milestone[] = raw.map((m) => ({ ...m, weight: MILESTONE_WEIGHTS[m.id] }));
  const milestonePartial = round(milestones.reduce((acc, m) => acc + m.score * m.weight, 0));
  const allMet = milestones.every((m) => m.met);
  return { milestones, milestonePartial, allMet };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
