import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SellerView } from './index.js';
import { detectPhase, routeModel, PHASE_MODEL_MAP, type Phase } from './ensemble.js';

/** Minimal SellerView factory — only the fields detectPhase reads. */
function view(o: Partial<SellerView> & { transcriptText?: string[] } = {}): SellerView {
  const transcript = (o.transcriptText ?? []).map((content, i) => ({
    index: i, kind: 'call_turn' as const, actor: 'buyer' as const,
    content, week: o.week ?? 1, slot: 0, timestamp: '',
  }));
  return {
    scenario: { seller_brief: '', list_price: '' },
    week: o.week ?? 1,
    totalWeeks: o.totalWeeks ?? 6,
    slotsRemainingThisWeek: 1,
    knownPersonas: o.knownPersonas ?? [],
    openCall: o.openCall,
    transcript: o.transcript ?? transcript,
  };
}

const contact = { id: 'ana', name: 'Ana', role: 'VP Eng' };
const eb = { id: 'cfo', name: 'Dana', role: 'CFO', isEconomicBuyer: true };

test('prospecting: no personas known yet', () => {
  assert.equal(detectPhase(view({ knownPersonas: [] })), 'prospecting');
});

test('discovery: call open, EB not yet known', () => {
  assert.equal(
    detectPhase(view({ knownPersonas: [contact], openCall: { personaId: 'ana', turnsRemaining: 3 } })),
    'discovery',
  );
});

test('access: personas known, not in call, EB not known', () => {
  assert.equal(detectPhase(view({ knownPersonas: [contact] })), 'access');
});

test('eb_value: EB known, pricing not raised, not near end', () => {
  assert.equal(detectPhase(view({ knownPersonas: [contact, eb], week: 2, totalWeeks: 6 })), 'eb_value');
});

test('close: pricing mentioned in recent transcript', () => {
  assert.equal(
    detectPhase(view({ knownPersonas: [contact], week: 2, totalWeeks: 6, transcriptText: ["let's talk pricing and the discount"] })),
    'close',
  );
});

test('close: final two weeks even without pricing keywords', () => {
  assert.equal(detectPhase(view({ knownPersonas: [contact, eb], week: 5, totalWeeks: 6 })), 'close');
});

test('close takes precedence over eb_value when pricing is live', () => {
  assert.equal(
    detectPhase(view({ knownPersonas: [contact, eb], week: 2, totalWeeks: 6, transcriptText: ['can you send a quote?'] })),
    'close',
  );
});

test('discovery does NOT trigger close on an unrelated word', () => {
  assert.equal(
    detectPhase(view({ knownPersonas: [contact], openCall: { personaId: 'ana', turnsRemaining: 3 }, transcriptText: ['walk me through your process end to end'] })),
    'discovery',
  );
});

test('PHASE_MODEL_MAP is total over the Phase enum', () => {
  const phases: Phase[] = ['prospecting', 'discovery', 'access', 'eb_value', 'close'];
  for (const p of phases) {
    assert.ok(typeof PHASE_MODEL_MAP[p] === 'string' && PHASE_MODEL_MAP[p].includes(':'), `phase ${p} maps to a provider:model spec`);
  }
  assert.equal(Object.keys(PHASE_MODEL_MAP).length, phases.length);
});

test('routeModel returns the mapped model for the detected phase', () => {
  assert.equal(routeModel(view({ knownPersonas: [] })), PHASE_MODEL_MAP.prospecting);
  assert.equal(routeModel(view({ knownPersonas: [contact, eb], week: 5, totalWeeks: 6 })), PHASE_MODEL_MAP.close);
});

import { EnsembleSeller, createSeller } from './index.js';
import type { SellerAdapter, SellerAction } from './index.js';

test('EnsembleSeller.id reflects the pack flag', () => {
  assert.equal(new EnsembleSeller(false).id, 'ensemble:best-of-best');
  assert.equal(new EnsembleSeller(true).id, 'ensemble:best-of-best+pack');
});

test('EnsembleSeller delegates to the model routed for the phase and passes pack through', async () => {
  const calls: Array<{ spec: string; pack: boolean }> = [];
  const stub: SellerAdapter = { id: 'stub', nextAction: async (): Promise<SellerAction> => ({ type: 'internal_note', content: 'ok' }) };
  const fakeFactory = (spec: string, pack: boolean): SellerAdapter => { calls.push({ spec, pack }); return stub; };

  const ens = new EnsembleSeller(true, fakeFactory);
  const action = await ens.nextAction(view({ knownPersonas: [] })); // prospecting

  assert.equal(calls.length, 1);
  assert.equal(calls[0].spec, PHASE_MODEL_MAP.prospecting);
  assert.equal(calls[0].pack, true);
  assert.equal(action.content, 'ok');
});

test('createSeller resolves the ensemble spec to an EnsembleSeller', () => {
  const s = createSeller('ensemble:best-of-best', false);
  assert.ok(s instanceof EnsembleSeller);
  assert.equal(s.id, 'ensemble:best-of-best');
});
