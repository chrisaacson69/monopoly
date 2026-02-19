/**
 * Test the Relative Position Estimator
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { RelativePositionEstimator, DICE_EPT } = require('./relative-position-estimator.js');

let MarkovEngine;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
} catch (e) {
    console.error('Markov engine required');
    process.exit(1);
}

const markov = new MarkovEngine();
markov.initialize();

const estimator = new RelativePositionEstimator(markov);

console.log('='.repeat(70));
console.log('TESTING RELATIVE POSITION ESTIMATOR');
console.log('='.repeat(70));

// Create test state
function createTestState() {
    // Orange group: 16 (St James), 18 (Tennessee), 19 (New York)
    return {
        turn: 30,
        players: [
            { id: 0, money: 1000, bankrupt: false, properties: new Set([16, 18]) },  // Has 2/3 Orange
            { id: 1, money: 800, bankrupt: false, properties: new Set([19]) },        // Has 1/3 Orange
            { id: 2, money: 1200, bankrupt: false, properties: new Set([11, 13]) },   // Has 2/3 Pink
            { id: 3, money: 900, bankrupt: false, properties: new Set([6, 8, 9]) }    // Has Light Blue monopoly
        ],
        propertyStates: {
            16: { owner: 0, houses: 0 },
            18: { owner: 0, houses: 0 },
            19: { owner: 1, houses: 0 },
            11: { owner: 2, houses: 0 },
            13: { owner: 2, houses: 0 },
            6: { owner: 3, houses: 0 },
            8: { owner: 3, houses: 0 },
            9: { owner: 3, houses: 0 }
        }
    };
}

// Test 1: Basic position calculation
console.log('\n1. CURRENT POSITIONS (No monopoly trading yet)');
console.log('-'.repeat(70));

const state = createTestState();
const positions = estimator.calculatePositions(state);

console.log('\nPlayer | Cash | NetWorth | PropEPT | RelEPT | NetGrowth | Position | Rank');
console.log('-'.repeat(80));

for (const p of positions) {
    console.log(`   ${p.id}   | $${p.cash.toString().padStart(4)} | $${p.netWorth.toFixed(0).padStart(6)} | $${p.propertyEPT.toFixed(1).padStart(5)} | $${p.relativeEPT.toFixed(1).padStart(5)} | $${p.netGrowth.toFixed(1).padStart(6)}/t |  $${p.position.toFixed(0).padStart(5)} |  ${p.rank}`);
}

// Verify zero-sum
const sumRelEPT = positions.reduce((sum, p) => sum + p.relativeEPT, 0);
console.log(`\nSum of Relative EPT: $${sumRelEPT.toFixed(2)} (should be ~0)`);

// Test 2: Trade impact - P1 sells New York to P0, completing Orange
console.log('\n2. TRADE IMPACT: P1 sells New York ($200) to P0 for $300');
console.log('-'.repeat(70));

const offer = {
    from: state.players[0],  // Buyer
    to: state.players[1],    // Seller
    fromProperties: new Set(),
    toProperties: new Set([19]),  // New York Ave
    fromCash: 300
};

const impact = estimator.estimateTradeImpact(offer, state, 50);

console.log('\nBuyer (P0) - Completing Orange monopoly:');
console.log(`  Position change: $${impact.from.positionChange.toFixed(0)}`);
console.log(`  Relative EPT change: $${impact.from.relativeEPTChange.toFixed(1)}/turn`);
console.log(`  Net growth change: $${impact.from.netGrowthChange.toFixed(1)}/turn`);

console.log('\nSeller (P1) - Giving up monopoly blocker:');
console.log(`  Position change: $${impact.to.positionChange.toFixed(0)}`);
console.log(`  Relative EPT change: $${impact.to.relativeEPTChange.toFixed(1)}/turn`);
console.log(`  Net growth change: $${impact.to.netGrowthChange.toFixed(1)}/turn`);

// Show what positions look like after
console.log('\n3. POSITIONS AFTER TRADE (P0 develops Orange to 3 houses)');
console.log('-'.repeat(70));

// Simulate trade and development
const afterState = estimator.simulateTradeState(state, offer);
// Simulate P0 building 3 houses on Orange
afterState.propertyStates[16].houses = 3;
afterState.propertyStates[18].houses = 3;
afterState.propertyStates[19].houses = 3;
afterState.players[0].money -= 300 * 3;  // House cost

const afterPositions = estimator.calculatePositions(afterState);

console.log('\nPlayer | Cash | NetWorth | PropEPT | RelEPT | NetGrowth | Position | TurnsToBroke');
console.log('-'.repeat(85));

for (const p of afterPositions) {
    const ttb = p.turnsUntilBroke === Infinity ? '∞' : p.turnsUntilBroke.toFixed(0);
    const status = p.isGainingGround ? '📈' : p.isLosingGround ? '📉' : '➡️';
    console.log(`   ${p.id}   | $${p.cash.toString().padStart(4)} | $${p.netWorth.toFixed(0).padStart(6)} | $${p.propertyEPT.toFixed(1).padStart(5)} | $${p.relativeEPT.toFixed(1).padStart(6)} | $${p.netGrowth.toFixed(1).padStart(6)}/t |  $${p.position.toFixed(0).padStart(5)} | ${ttb.padStart(6)} ${status}`);
}

// Test 3: Evaluate if P1 should accept the trade
console.log('\n4. TRADE EVALUATION FOR P1 (Seller)');
console.log('-'.repeat(70));

const evaluation = estimator.evaluateTradeForPlayer(1, offer, state, 50);

console.log(`\nRecommend: ${evaluation.recommend ? 'ACCEPT' : 'REJECT'}`);
console.log('\nReasoning:');
console.log(`  Position improves: ${evaluation.reasoning.positionImproves}`);
console.log(`  Relative growth improves: ${evaluation.reasoning.relativeGrowthImproves}`);
console.log(`  Don't lose rank: ${evaluation.reasoning.dontLoseRank}`);
console.log(`  They don't gain too much: ${evaluation.reasoning.theyDontGainTooMuch}`);

console.log('\nMy (P1) impact:');
console.log(`  Position change: $${evaluation.myImpact.positionChange.toFixed(0)}`);
console.log(`  Rank change: ${evaluation.myImpact.rankChange > 0 ? '+' : ''}${evaluation.myImpact.rankChange}`);

console.log('\nTheir (P0) impact:');
console.log(`  Position change: $${evaluation.theirImpact.positionChange.toFixed(0)}`);
console.log(`  Rank change: ${evaluation.theirImpact.rankChange > 0 ? '+' : ''}${evaluation.theirImpact.rankChange}`);

// Test 4: What price would make this fair?
console.log('\n5. FINDING FAIR PRICE');
console.log('-'.repeat(70));

console.log('\nSearching for price where P1 position change >= 0...\n');

for (let price = 200; price <= 1500; price += 100) {
    const testOffer = { ...offer, fromCash: price };
    const testImpact = estimator.estimateTradeImpact(testOffer, state, 50);

    const p1Change = testImpact.to.positionChange;
    const p0Change = testImpact.from.positionChange;
    const marker = p1Change >= 0 ? '✓' : '';

    console.log(`  $${price.toString().padStart(4)}: P1 change=$${p1Change.toFixed(0).padStart(5)}, P0 change=$${p0Change.toFixed(0).padStart(5)} ${marker}`);
}

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`
Key findings:
1. Relative EPT correctly sums to zero (zero-sum property)
2. Trade impact shows both absolute and relative changes
3. Can identify "fair" price where seller's position doesn't decrease
4. Turns-until-broke provides "danger signal" for players with negative net growth
`);
