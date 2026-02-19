/**
 * Compare trade evaluation between Growth and NPV AI
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');
const { GrowthTradingAI } = require('./growth-trading-ai.js');
const { NPVTradingAI } = require('./npv-trading-ai.js');
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

console.log('='.repeat(70));
console.log('TRADE EVALUATION COMPARISON: Growth vs NPV vs Standard');
console.log('='.repeat(70));

// Mock state: Player 0 owns New York, Player 1 owns St James + Tennessee
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
            16: { owner: 1, houses: 0 },  // St. James
            18: { owner: 1, houses: 0 },  // Tennessee
            19: { owner: 0, houses: 0 }   // New York (completes Orange for buyer)
        }
    };
}

console.log('\nScenario: Selling New York Ave ($200) to complete buyer\'s Orange monopoly');
console.log('Seller (Player 0) has $1000 cash');
console.log('Buyer (Player 1) has $1000 cash + owns St James + Tennessee');
console.log('');

// Test what each AI demands to sell New York Ave
const state = createMockState();

// Create each AI as the seller (Player 0)
const growthAI = new GrowthTradingAI(state.players[0], null, markov, null);
growthAI.player = state.players[0];
growthAI.probs = probs;

const npvAI = new NPVTradingAI(state.players[0], null, markov, null);
npvAI.player = state.players[0];
npvAI.probs = probs;

const tradingAI = new TradingAI(state.players[0], null, markov, null);
tradingAI.player = state.players[0];
tradingAI.probs = probs;

// What cash offers would each AI accept?
console.log('Cash offers to sell New York Ave:');
console.log('-'.repeat(70));
console.log('Offer    | Growth AI | NPV AI    | Standard Trading');
console.log('-'.repeat(70));

for (const cashOffer of [100, 150, 200, 250, 300, 400, 500, 600, 700, 800]) {
    const offer = {
        from: state.players[1],  // Buyer
        to: state.players[0],    // Seller (us)
        fromProperties: new Set(),
        toProperties: new Set([19]),  // New York Ave
        fromCash: cashOffer
    };

    const growthAccepts = growthAI.evaluateTrade(offer, state);
    const npvAccepts = npvAI.evaluateTrade(offer, state);
    const tradingAccepts = tradingAI.evaluateTrade(offer, state);

    console.log(`$${cashOffer.toString().padEnd(7)} | ${(growthAccepts ? 'ACCEPT' : 'REJECT').padEnd(9)} | ${(npvAccepts ? 'ACCEPT' : 'REJECT').padEnd(9)} | ${tradingAccepts ? 'ACCEPT' : 'REJECT'}`);
}

// Calculate the minimum acceptable offers
console.log('\n' + '='.repeat(70));
console.log('ANALYSIS: Why do they differ?');
console.log('='.repeat(70));

// Growth AI calculation
const opponents = 3;
const growthNPV = growthAI.calculateGrowthNPV('orange', 1000, opponents);
console.log(`\nGrowth AI:`);
console.log(`  Orange monopoly growth NPV (buyer has $1000): $${growthNPV.toFixed(0)}`);
console.log(`  Seller demands: 30% of that = $${(growthNPV * 0.30).toFixed(0)}`);

// NPV AI calculation
const npvValue = npvAI.calculateMonopolyNPV('orange', state);
console.log(`\nNPV AI:`);
console.log(`  Orange monopoly NPV: $${npvValue.netNPV.toFixed(0)}`);
console.log(`    (grossNPV=$${npvValue.grossNPV.toFixed(0)}, houseCost=$${npvValue.houseCost})`);
console.log(`  Seller demands: 35% of netNPV = $${(npvValue.netNPV * 0.35).toFixed(0)}`);

// Standard Trading AI calculation
const blockingValue = tradingAI.calculateBlockingValue(19, state.players[1], state);
console.log(`\nStandard Trading AI:`);
console.log(`  Blocking value (EPT gain): $${blockingValue.toFixed(0)}`);
console.log(`  Seller demands: property value + 40% of blocking = $${(200 + blockingValue * 0.40).toFixed(0)}`);

console.log('\n' + '='.repeat(70));
console.log('KEY INSIGHT');
console.log('='.repeat(70));
console.log(`
Growth AI uses the actual growth curve NPV which depends on buyer's cash.
NPV AI uses a simpler discount-rate formula.
Standard Trading uses EPT-based blocking value.

The differences in minimum acceptable offer:
- Growth AI may accept lower offers because it values the cash for its own development
- NPV AI demands based on annuity formula NPV
- Standard Trading demands based on instant 3-house EPT

If Growth AI is too willing to sell (low threshold), it enables opponents
to get monopolies cheaply, which hurts its win rate.
`);

// Now show what buyers would offer
console.log('='.repeat(70));
console.log('AS BUYER: What would each AI offer to complete Orange?');
console.log('='.repeat(70));

// Create AIs as buyer (Player 1)
state.players[1].money = 1000;
const growthBuyer = new GrowthTradingAI(state.players[1], null, markov, null);
growthBuyer.player = state.players[1];
growthBuyer.probs = probs;

const npvBuyer = new NPVTradingAI(state.players[1], null, markov, null);
npvBuyer.player = state.players[1];
npvBuyer.probs = probs;

const tradingBuyer = new TradingAI(state.players[1], null, markov, null);
tradingBuyer.player = state.players[1];
tradingBuyer.probs = probs;

const growthOffer = growthBuyer.calculateMonopolyCashOffer(new Set([19]), 150, state);
const npvOffer = npvBuyer.calculateMonopolyCashOffer(new Set([19]), 150, state);
const tradingOffer = tradingBuyer.calculateMonopolyCashOffer(new Set([19]), 150, state);

console.log(`\nGrowth AI offers:  $${growthOffer}`);
console.log(`NPV AI offers:     $${npvOffer}`);
console.log(`Standard offers:   $${tradingOffer}`);
