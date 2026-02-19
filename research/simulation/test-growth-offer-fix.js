/**
 * Test that Growth AI offer calculation is fixed
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');
const { TradingAI } = require('./trading-ai.js');

let MarkovEngine;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
} catch (e) {
    console.error('Markov engine required');
    process.exit(1);
}

const markov = new MarkovEngine();
markov.initialize();
const probs = markov.getAllProbabilities('stay');

console.log('='.repeat(60));
console.log('TESTING GROWTH AI OFFER CALCULATION FIX');
console.log('='.repeat(60));

function createMockState(playerMoney) {
    return {
        turn: 20,
        players: [
            { id: 0, money: playerMoney, bankrupt: false, properties: new Set([16, 18]) },  // We own St James + Tennessee
            { id: 1, money: 1000, bankrupt: false, properties: new Set([19]) },  // They own New York
            { id: 2, money: 1000, bankrupt: false, properties: new Set() },
            { id: 3, money: 1000, bankrupt: false, properties: new Set() }
        ],
        propertyStates: {
            16: { owner: 0, houses: 0 },
            18: { owner: 0, houses: 0 },
            19: { owner: 1, houses: 0 }
        }
    };
}

console.log('\nOffer comparison: Growth vs Standard Trading AI');
console.log('Scenario: Need New York Ave to complete Orange monopoly');
console.log('-'.repeat(60));

const testCases = [
    { cash: 500, label: '$500 cash' },
    { cash: 750, label: '$750 cash' },
    { cash: 1000, label: '$1000 cash' },
    { cash: 1500, label: '$1500 cash' },
    { cash: 2000, label: '$2000 cash' },
];

// Orange group house cost: $100 per house, 3 properties = $300 per house level
// Cost to 3 houses: $900
const orangeHouseCost = 100;
const costTo3Houses = orangeHouseCost * 3 * 3;  // $900

console.log(`\nOrange monopoly stats:`);
console.log(`  House cost: $${orangeHouseCost} per house`);
console.log(`  Cost to 3 houses: $${costTo3Houses}`);
console.log(`  New York price: $${BOARD[19].price}`);

console.log('\nCash     | Growth Offer | Trading Offer | Cash After (Growth) | Development Reserve');
console.log('-'.repeat(90));

for (const test of testCases) {
    const state = createMockState(test.cash);

    // Create Growth AI
    const growthAI = new GrowthTradingAI(state.players[0], null, markov, null);
    growthAI.player = state.players[0];
    growthAI.probs = probs;

    // Create Standard AI
    const tradingAI = new TradingAI(state.players[0], null, markov, null);
    tradingAI.player = state.players[0];
    tradingAI.probs = probs;

    const growthOffer = growthAI.calculateMonopolyCashOffer(new Set([19]), 150, state);
    const tradingOffer = tradingAI.calculateMonopolyCashOffer(new Set([19]), 150, state);

    const cashAfterGrowth = test.cash - growthOffer;
    const devReserve = Math.min(costTo3Houses * 0.5, test.cash * 0.4);

    console.log(`$${test.cash.toString().padEnd(6)} | $${growthOffer.toString().padEnd(11)} | $${tradingOffer.toString().padEnd(12)} | $${cashAfterGrowth.toString().padEnd(18)} | $${devReserve.toFixed(0)}`);
}

// Now test NPV at different cash levels to show the growth curve impact
console.log('\n' + '='.repeat(60));
console.log('NPV AT DIFFERENT CASH-AFTER-TRADE LEVELS');
console.log('='.repeat(60));

const growthAI = new GrowthTradingAI({ id: 0, money: 1500 }, null, markov, null);
growthAI.probs = probs;

console.log('\nOrange monopoly NPV (50-turn projection, 3 opponents):');
console.log('Cash After Trade | NPV       | Turns to 3H (approx)');
console.log('-'.repeat(55));

for (const cashAfter of [0, 200, 400, 600, 800, 1000, 1200]) {
    const npv = growthAI.calculateGrowthNPV('orange', cashAfter, 3);

    // Estimate turns to 3 houses
    const ept0 = growthAI.calculateGroupEPT('orange', 0, 3);
    let cash = cashAfter;
    let houses = 0;
    let turns = 0;
    while (houses < 3 && turns < 50) {
        cash += ept0;  // Simplified - actual EPT varies
        while (houses < 3 && cash >= 300) {
            cash -= 300;
            houses++;
        }
        turns++;
    }
    const turnsTo3H = turns < 50 ? turns : '>50';

    console.log(`$${cashAfter.toString().padEnd(15)} | $${npv.toFixed(0).padEnd(8)} | ${turnsTo3H}`);
}

console.log('\n' + '='.repeat(60));
console.log('KEY INSIGHT');
console.log('='.repeat(60));
console.log(`
The Growth AI now:
1. Samples multiple offer points to find best net value (NPV - offer)
2. Keeps development reserve (40-50% of cost to 3 houses)
3. Scales offer up if cash-rich (can afford higher premium)
4. Won't offer if even base price isn't worth it

This should make offers more competitive with Standard Trading AI
while still accounting for cash-after-trade development speed.
`);
