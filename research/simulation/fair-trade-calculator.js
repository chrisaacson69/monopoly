/**
 * Fair Trade Calculator
 *
 * Calculates what a "fair" trade should be based on:
 * 1. What the buyer gains (monopoly EPT)
 * 2. What the seller loses (blocking value + opportunity cost)
 * 3. Cash equivalence
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

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

/**
 * Calculate the EPT value of a monopoly at 3 houses
 */
function getMonopolyEPT(group, opponents = 3) {
    const squares = COLOR_GROUPS[group].squares;
    let totalEPT = 0;
    for (const sq of squares) {
        totalEPT += probs[sq] * BOARD[sq].rent[3] * opponents;
    }
    return totalEPT;
}

/**
 * Calculate how much cash should equal a monopoly's value
 *
 * Key insight: A monopoly at 3 houses generates ~$150 EPT per turn.
 * Over 50 turns, that's $7500 in expected income.
 * But we need to account for:
 * - House investment cost (~$150/house × 9 houses = $1350)
 * - Time value of money (earlier money is worth more)
 * - Risk (might not land on properties)
 */
function monopolyToCash(eptPerTurn, houseCost, turnsRemaining = 50) {
    // Simple model: cash = EPT × turns × discount factor
    // Discount factor accounts for risk and time value
    const discountFactor = 0.5;  // Conservative

    const grossValue = eptPerTurn * turnsRemaining * discountFactor;
    const netValue = grossValue - houseCost;

    return Math.max(0, netValue);
}

/**
 * Calculate the "blocking value" of a property
 *
 * If I hold this property, I prevent opponent from getting their monopoly.
 * The value of blocking = value of what they would gain if I sold.
 */
function getBlockingValue(position, opponents = 3) {
    const square = BOARD[position];
    if (!square.group) return 0;

    // What monopoly would opponent get?
    const monopolyEPT = getMonopolyEPT(square.group, opponents);
    const houseCost = square.housePrice * 3 * COLOR_GROUPS[square.group].squares.length;

    return monopolyToCash(monopolyEPT, houseCost);
}

console.log('='.repeat(70));
console.log('FAIR TRADE VALUE CALCULATOR');
console.log('='.repeat(70));
console.log('\nAssuming 3 opponents, 50 turns remaining, 50% discount factor\n');

// Calculate for each color group
const groups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

console.log('MONOPOLY VALUES:');
console.log('-'.repeat(70));
console.log(String('Group').padEnd(12) +
            String('EPT@3H').padStart(10) +
            String('House Cost').padStart(12) +
            String('Cash Value').padStart(12) +
            String('Per Property').padStart(14));
console.log('-'.repeat(70));

for (const group of groups) {
    const squares = COLOR_GROUPS[group].squares;
    const ept = getMonopolyEPT(group);
    const houseCost = BOARD[squares[0]].housePrice * 3 * squares.length;
    const cashValue = monopolyToCash(ept, houseCost);
    const perProperty = Math.floor(cashValue / squares.length);

    console.log(
        group.padEnd(12) +
        `$${ept.toFixed(0)}`.padStart(10) +
        `$${houseCost}`.padStart(12) +
        `$${cashValue.toFixed(0)}`.padStart(12) +
        `$${perProperty}`.padStart(14)
    );
}

console.log('\n' + '='.repeat(70));
console.log('EXAMPLE TRADE ANALYSIS');
console.log('='.repeat(70));

// Example: Trading New York Avenue to complete Orange monopoly
console.log('\nScenario: Selling New York Avenue to opponent who owns St. James + Tennessee');
console.log('-'.repeat(70));

const nyaPrice = 200;
const orangeEPT = getMonopolyEPT('orange');
const orangeHouseCost = 100 * 3 * 3;  // $100/house × 3 houses × 3 properties
const orangeCashValue = monopolyToCash(orangeEPT, orangeHouseCost);

console.log(`New York Avenue face value: $${nyaPrice}`);
console.log(`Orange monopoly EPT@3H: $${orangeEPT.toFixed(2)}`);
console.log(`Orange house investment: $${orangeHouseCost}`);
console.log(`Orange monopoly cash equivalent: $${orangeCashValue.toFixed(0)}`);
console.log(`\nFair trade price for NYA: $${Math.floor(orangeCashValue)} (monopoly value)`);
console.log(`  - This accounts for blocking value`);
console.log(`  - Current AI would accept: ~$${nyaPrice + 100} (property + small penalty)`);

// What the current AI does vs what it should do
console.log('\n' + '='.repeat(70));
console.log('CURRENT AI vs FAIR VALUATION');
console.log('='.repeat(70));

for (const group of groups) {
    const squares = COLOR_GROUPS[group].squares;
    const avgPrice = squares.reduce((sum, sq) => sum + BOARD[sq].price, 0) / squares.length;
    const ept = getMonopolyEPT(group);
    const houseCost = BOARD[squares[0]].housePrice * 3 * squares.length;
    const fairValue = monopolyToCash(ept, houseCost) / squares.length;

    // Current AI accepts: property price + $100 penalty ≈ property price × 1.5
    const currentAccepts = avgPrice * 1.5 + 100;

    console.log(`\n${group.toUpperCase()}:`);
    console.log(`  Current AI accepts: ~$${Math.floor(currentAccepts)} per property`);
    console.log(`  Fair value:         ~$${Math.floor(fairValue)} per property`);
    console.log(`  Difference:         ${fairValue > currentAccepts ? '+' : ''}$${Math.floor(fairValue - currentAccepts)} (${((fairValue/currentAccepts - 1) * 100).toFixed(0)}%)`);
}

console.log('\n' + '='.repeat(70));
console.log('IMPLICATIONS');
console.log('='.repeat(70));
console.log(`
The current TradingAI:
1. BUYER calculates fair offer based on monopoly EPT (correct approach)
2. But caps at 50% of available cash (often way below fair value)
3. SELLER accepts if cash ≥ property price + small penalty
4. Seller doesn't account for BLOCKING VALUE

Result: Trades happen at far below fair value because:
- Buyers can't afford fair price early game
- Sellers don't properly value what they're giving up

Potential fixes:
1. Seller should calculate opponent's monopoly gain and demand fair share
2. Use blocking value in acceptance calculation
3. Reject trades that would give opponent decisive advantage
`);
