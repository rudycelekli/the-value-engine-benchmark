// benchmark/src/env/buyer-transcript.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario } from '../engine/scenario.js';
import { BuyerAgent } from '../buyer/index.js';
import { BuyerStateMachine, type BehaviorAnalysis } from '../buyer/state-machine.js';
import { verifyScenario } from './verifier.js';
import { buyerSimVersion } from './buyer-sim.js';
import { BuyerTranscript } from './buyer-transcript.js';

const META = { buyerSim: buyerSimVersion(), taskChecksum: 'abc', seed: 7 };
const emptyAnalysis = {} as unknown as BehaviorAnalysis;

test('record then replay returns the exact stored text; missing key throws', () => {
  const rec = new BuyerTranscript('record', META);
  rec.record('maya:email:0', 'maya', 'email', 'hello from maya');
  const rep = new BuyerTranscript('replay', META, rec.entries());
  assert.equal(rep.replay('maya:email:0'), 'hello from maya');
  assert.throws(() => rep.replay('maya:email:1'), /no recorded buyer turn/);
});

test('duplicate record key is rejected (transcripts are append-once)', () => {
  const rec = new BuyerTranscript('record', META);
  rec.record('k', 'p', 'call', 'one');
  assert.throws(() => rec.record('k', 'p', 'call', 'two'), /duplicate/);
});

test('assertFreeze refuses a transcript recorded against a different buyer-sim', () => {
  const stale = new BuyerTranscript('replay', { ...META, buyerSim: 'old-model@t0.1+smv2' });
  assert.throws(() => stale.assertFreeze(buyerSimVersion()), /version mismatch/);
  const ok = new BuyerTranscript('replay', META);
  assert.doesNotThrow(() => ok.assertFreeze(buyerSimVersion()));
});

test('save then load round-trips entries and meta (freeze survives disk)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veb-transcript-'));
  try {
    const rec = new BuyerTranscript('record', META);
    rec.record('a:call:0', 'a', 'call', 'first');
    rec.record('b:email:1', 'b', 'email', 'second');
    rec.save(dir);
    assert.ok(existsSync(join(dir, 'buyer-transcript.json')));
    const loaded = BuyerTranscript.load(dir);
    assert.equal(loaded.replay('a:call:0'), 'first');
    assert.equal(loaded.replay('b:email:1'), 'second');
    assert.equal(loaded.meta.buyerSim, META.buyerSim);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BuyerAgent in replay mode returns the frozen text, never invoking the generator', async () => {
  const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
  const pid = scenario.personas[0].id;
  const sm = new BuyerStateMachine(scenario);
  // Pre-seed the deterministic first-ordinal key with a sentinel the mock buyer
  // would never emit — proving replay short-circuits generation entirely.
  const rep = new BuyerTranscript('replay', META, [
    { key: `${pid}:email:0`, personaId: pid, kind: 'email', text: 'SENTINEL-FROZEN-REPLY' },
  ]);
  const buyer = new BuyerAgent(scenario, sm, true, rep);
  const reply = await buyer.respond(pid, 'email', 'hi', emptyAnalysis, [], []);
  assert.equal(reply.text, 'SENTINEL-FROZEN-REPLY');
});

test('record→replay reproduces the oracle reward bit-for-bit and refuses a stale env', async () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'veb-transcript-runs-'));
  const tdir = mkdtempSync(join(tmpdir(), 'veb-transcript-store-'));
  try {
    const scenario = loadScenario('scenarios/01-logistics-saas.yaml', 'scenarios');
    const recorded = await verifyScenario({
      scenario,
      sellerSpec: 'scripted-disciplined',
      pack: false,
      mock: true,
      runsDir,
      buyerMode: 'record',
      transcriptDir: tdir,
    });
    assert.equal(recorded.result.resolved, true);
    assert.equal(recorded.result.reward, 1);
    assert.ok(existsSync(join(tdir, 'buyer-transcript.json')));

    const replayed = await verifyScenario({
      scenario,
      sellerSpec: 'scripted-disciplined',
      pack: false,
      mock: true,
      runsDir,
      buyerMode: 'replay',
      transcriptDir: tdir,
    });
    assert.equal(replayed.result.reward, recorded.result.reward);
    assert.equal(replayed.result.resolved, true);

    // Freeze enforcement: a transcript from a different buyer-sim is refused.
    const stale = BuyerTranscript.load(tdir);
    assert.throws(() => stale.assertFreeze('some-other-model@t0.0+smv1'), /version mismatch/);
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
    rmSync(tdir, { recursive: true, force: true });
  }
});
