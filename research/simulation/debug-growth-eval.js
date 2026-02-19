/**
 * Debug Growth AI trade evaluation
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');

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

function createMockState() {
    return {
        turn: 20,
        players: [
            { id: 0, money: 1000, bankrupt: false, properties: new Set([19]),
              hasMonopoly: () => false },
            { id: 1, money: 1000, bankrupt: false, properties: new Set([16, 18]),
              hasMonopoly: () => false },
            { id: 2, money: 1000, bankrupt: false, properties: new Set(),
              hasMonopoly: () => false },
            { id: 3, money: 1000, bankrupt: false, properties: new Set(),
              hasMonopoly: () => false }
        ],
        propertyStates: {
            16: { owner: 1, houses: 0 },
            18: { owner: 1, houses: 0 },
            19: { owner: 0, houses: 0 }
        }
    };
}

console.log('='.repeat(70));
console.log('DEBUG: Growth AI Trade Evaluation');
console.log('='.repeat(70));

const state = createMockState();

const growthAI = new GrowthTradingAI(state.players[0], null, markov, null);
growthAI.player = state.players[0];
growthAI.probs = probs;

// Manually trace through evaluateTrade for $500 offer
const offer = {
    from: state.players[1],  // Buyer
    to: state.players[0],    // Seller (us)
    fromProperties: new Set(),
    toProperties: new Set([19]),  // New York Ave
    fromCash: 500
};

const opponents = 3;

console.log('\nOffer: $500 for New York Ave');
console.log('We are seller (Player 0), they are buyer (Player 1)');
console.log('');

// Check the cases in evaluateTrade:
// - myMonopolyGroup: We don't complete a monopoly (fromProperties is empty)
// - opponentMonopolyGroup: They complete Orange

console.log('Case analysis:');
console.log('  fromProperties: empty (no properties coming to us)');
console.log('  toProperties: New York Ave (19)');
console.log('  fromCash: $500');
console.log('');

// Check if we complete a monopoly (no - fromProperties is empty)
console.log('  We complete a monopoly? NO (fromProperties is empty)');

// Check if they complete a monopoly
const square = BOARD[19];
const groupSquares = COLOR_GROUPS[square.group].squares;
const opponentWouldOwn = groupSquares.filter(sq =>
    state.propertyStates[sq]?.owner === 1 || new Set([19]).has(sq)
).length;
console.log('  They complete a monopoly? ' + (opponentWouldOwn === groupSquares.length ? 'YES' : 'NO'));
console.log('');

// This means we hit Case 2: "They get a monopoly, I don't"
console.log('This is Case 2: They get monopoly, we don\'t');
console.log('');

// Calculate theirValue
const opponentCashAfter = state.players[1].money - 500;  // 1000 - 500 = 500
const theirMonopolyNPV = growthAI.calculateGrowthNPV('orange', opponentCashAfter, opponents);
console.log('Opponent cash after trade: $' + opponentCashAfter);
console.log('Their monopoly growth NPV: $' + theirMonopolyNPV.toFixed(0));

// theirValue starts at -fromCash (they pay) + monopoly NPV
let theirValue = -500;  // They pay $500
theirValue += theirMonopolyNPV;
console.log('');
console.log('theirValue calculation:');
console.log('  -fromCash = -$500');
console.log('  + their monopoly NPV = +$' + theirMonopolyNPV.toFixed(0));
console.log('  = $' + theirValue.toFixed(0));

// minCashRequired = theirValue * 0.30
const minCashRequired = theirValue * 0.30;
console.log('');
console.log('minCashRequired = theirValue * 0.30 = $' + minCashRequired.toFixed(0));
console.log('fromCash ($500) >= minCashRequired ($' + minCashRequired.toFixed(0) + ')? ' + (500 >= minCashRequired));

console.log('\n' + '='.repeat(70));
console.log('THE BUG IS HERE');
console.log('='.repeat(70));
console.log(`
The Growth AI's Case 2 logic says:
  "Accept if cash received >= 30% of their monopoly value"

But 'theirValue' includes BOTH their monopoly NPV AND the negative cash they pay.
So theirValue = -$500 + $5757 = $5257

And minCashRequired = $5257 * 0.30 = $1577

But we're only receiving $500, so we reject.

Wait, that's correct behavior! Let me check what happens at $800...
`);

// Test at $800
const offer800 = { ...offer, fromCash: 800 };
const opponentCashAfter800 = state.players[1].money - 800;  // 200
const theirMonopolyNPV800 = growthAI.calculateGrowthNPV('orange', opponentCashAfter800, opponents);
const theirValue800 = -800 + theirMonopolyNPV800;
const minCashRequired800 = theirValue800 * 0.30;

console.log('At $800 offer:');
console.log('  Opponent cash after: $' + opponentCashAfter800);
console.log('  Their monopoly NPV: $' + theirMonopolyNPV800.toFixed(0));
console.log('  theirValue = -800 + ' + theirMonopolyNPV800.toFixed(0) + ' = $' + theirValue800.toFixed(0));
console.log('  minCashRequired = $' + minCashRequired800.toFixed(0));
console.log('  $800 >= $' + minCashRequired800.toFixed(0) + '? ' + (800 >= minCashRequired800));

// OH! The NPV at $200 cash-after is much lower
console.log('\n  KEY: With only $200 left, their monopoly NPV drops to $' + theirMonopolyNPV800.toFixed(0));
console.log('  This makes the trade more acceptable!');
