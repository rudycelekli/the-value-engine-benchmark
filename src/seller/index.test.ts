import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sellerSystem, type SellerView } from './index.js';

function view(): SellerView {
  return {
    scenario: { seller_brief: 'Sell the widget.', list_price: '$100,000' },
    week: 1,
    totalWeeks: 8,
    slotsRemainingThisWeek: 2,
    knownPersonas: [],
    transcript: [],
  };
}

test('OOB prompt ends with an emphatic JSON-only output contract (fable brace-free fix)', () => {
  const sys = sellerSystem(view(), false);
  // The mandatory contract must be the FINAL instruction (recency), not buried mid-list.
  assert.match(sys, /Output contract \(MANDATORY\)/);
  assert.match(sys, /first character of your reply must be "\{"/i);
  const contractIdx = sys.indexOf('Output contract (MANDATORY)');
  assert.ok(contractIdx > sys.length * 0.5, 'contract must be near the end, not mid-prompt');
});

test('pack prompt also carries the mandatory output contract as its final instruction', () => {
  const sys = sellerSystem(view(), true);
  assert.match(sys, /Output contract \(MANDATORY\)/);
  // Contract is the last thing the model reads, after the methodology block.
  assert.ok(sys.lastIndexOf('Output contract (MANDATORY)') > sys.indexOf('# Sales methodology'));
});
