/**
 * Check if NPV AI is rejecting deals it should accept
 *
 * Key question: Is NPV being too "fair" and missing good opportunities?
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { NPVTradingAI } = require('./npv-trading-ai.js');
const { TradingAI } = require('./trading-ai.js');

let MarkovEngine;
try {
    MarkovEngine = require('../../ai/markov-engine.js').MarkovEngine;
} catch (e) {
    console.error('Markov engine required');
    process.exit(1);
}

const markov = new MarkovEngine();
markov.initialize();
const probs = markov.getAllProbabilities('stay');

console.log('='.repeat(60));
console.log('CHECKING: Does NPV AI reject good deals?');
console.log('='.repeat(60));

// Create mock state for testing
function createMockState(turn, totalCash, playerMoney) {
    return {
        turn,
        players: [
            { id: 0, money: playerMoney, bankrupt: false, properties: new Set(),
              hasMonopoly: () => false },
            { id: 1, money: playerMoney, bankrupt: false, properties: new Set([16, 18]),  // St James, Tennessee
              hasMonopoly: () => false },
            { id: 2, money: playerMoney, bankrupt: false, properties: new Set(),
              hasMonopoly: () => false },
            { id: 3, money: playerMoney, bankrupt: false, properties: new Set(),
              hasMonopoly: () => false }
        ],
        propertyStates: {
            16: { owner: 1, houses: 0 },  // St. James - opponent
            18: { owner: 1, houses: 0 },  // Tennessee - opponent
            19: { owner: 0, houses: 0 },  // New York - us (the seller)
        }
    };
}

// Test scenarios: Would AI accept offer of $X for New York Ave?
// (completing opponent's Orange monopoly)

console.log('\nScenario: Opponent offers cash for New York Ave');
console.log('(Completes their Orange monopoly: 152 EPT @ 3 houses)\n');

const testCases = [
    { turn: 10, cash: 300, label: 'Early game, low offer' },
    { turn: 10, cash: 500, label: 'Early game, medium offer' },
    { turn: 10, cash: 800, label: 'Early game, high offer' },
    { turn: 40, cash: 300, label: 'Mid game, low offer' },
    { turn: 40, cash: 500, label: 'Mid game, medium offer' },
    { turn: 40, cash: 800, label: 'Mid game, high offer' },
    { turn: 70, cash: 300, label: 'Late game, low offer' },
    { turn: 70, cash: 500, label: 'Late game, medium offer' },
];

console.log('NPV AI Decisions:');
console.log('-'.repeat(60));

for (const test of testCases) {
    const state = createMockState(test.turn, 5000, 1250);

    // Create NPV AI as seller (player 0)
    const npvAI = new NPVTradingAI(state.players[0], null, markov, null);
    npvAI.player = state.players[0];
    npvAI.probs = probs;

    // Create Standard AI as seller for comparison
    const stdAI = new TradingAI(state.players[0], null, markov, null);
    stdAI.player = state.players[0];
    stdAI.probs = probs;

    // Trade offer: opponent pays cash for our New York Ave
    const offer = {
        from: state.players[1],  // Buyer
        to: state.players[0],    // Us (seller)
        fromProperties: new Set(),
        toProperties: new Set([19]),  // New York Ave
        fromCash: test.cash
    };

    const npvAccepts = npvAI.evaluateTrade(offer, state);
    const stdAccepts = stdAI.evaluateTrade(offer, state);

    // Calculate payback for buyer
    const orangeEPT = 152.59;
    const payback = test.cash / orangeEPT;

    const npvResult = npvAccepts ? 'ACCEPT' : 'REJECT';
    const stdResult = stdAccepts ? 'ACCEPT' : 'REJECT';
    const diff = npvAccepts !== stdAccepts ? ' <-- DIFFERENT!' : '';

    console.log(`${test.label.padEnd(25)} $${test.cash}: NPV=${npvResult.padEnd(6)} Std=${stdResult.padEnd(6)} (${payback.toFixed(1)} turn payback)${diff}`);
}

// Now test as BUYER - would AI make these offers?
console.log('\n' + '='.repeat(60));
console.log('As BUYER: What would each AI offer for Orange monopoly?');
console.log('='.repeat(60));

for (const turn of [10, 40, 70]) {
    const state = createMockState(turn, 5000, 1250);

    // We are buyer (player 1) who owns St James + Tennessee
    // We want New York Ave from player 0
    state.players[1].properties = new Set([16, 18]);
    state.players[0].properties = new Set([19]);
    state.propertyStates[16].owner = 1;
    state.propertyStates[18].owner = 1;
    state.propertyStates[19].owner = 0;

    // NPV AI as buyer
    const npvAI = new NPVTradingAI(state.players[1], null, markov, null);
    npvAI.player = state.players[1];
    npvAI.probs = probs;

    // Standard AI as buyer
    const stdAI = new TradingAI(state.players[1], null, markov, null);
    stdAI.player = state.players[1];
    stdAI.probs = probs;

    // What would they offer?
    const npvOffer = npvAI.calculateMonopolyCashOffer(new Set([19]), 150, state);
    const stdOffer = stdAI.calculateMonopolyCashOffer(new Set([19]), 150, state);

    console.log(`\nTurn ${turn}:`);
    console.log(`  NPV AI would offer: $${npvOffer.toFixed(0)}`);
    console.log(`  Std AI would offer: $${stdOffer.toFixed(0)}`);
    console.log(`  NPV payback: ${(npvOffer/152.59).toFixed(1)} turns`);
    console.log(`  Std payback: ${(stdOffer/152.59).toFixed(1)} turns`);
}

console.log('\n' + '='.repeat(60));
console.log('KEY INSIGHT');
console.log('='.repeat(60));
console.log(`
The question is: should we accept ANY offer that's profitable for us,
or demand "fair" compensation?

"Buyer beware" / "Seller beware" means:
- As BUYER: Don't overpay, but DO take steals when offered
- As SELLER: Don't undersell, but DO take good cash offers

Current NPV AI might be:
1. Too conservative as buyer (offering less, missing deals)
2. Too demanding as seller (rejecting offers that are still profitable)

A smarter approach: Accept if profitable for ME, regardless of opponent's gain.
`);
