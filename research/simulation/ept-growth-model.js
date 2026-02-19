/**
 * EPT Growth Model
 *
 * Models how a player's EPT grows over time as they invest in houses.
 *
 * Key insight: You can't just assume instant 3-house development.
 * The growth curve depends on:
 * 1. Starting cash after trade
 * 2. Initial EPT (monopoly rent × 2)
 * 3. House costs and rent increases
 * 4. Time to accumulate enough for each house
 *
 * This creates a compound growth effect:
 *   EPT → Cash → Houses → Higher EPT → Faster Cash → More Houses...
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
 * Calculate EPT for a monopoly at a given house level
 * @param group - Color group name
 * @param houses - Houses per property (0-5, where 5 = hotel)
 * @param opponents - Number of opponents
 */
function calculateGroupEPT(group, houses, opponents) {
    const squares = COLOR_GROUPS[group].squares;
    let totalEPT = 0;

    for (const sq of squares) {
        const prob = probs[sq] || 0.025;
        let rent;

        if (houses === 0) {
            // Monopoly bonus (double rent)
            rent = BOARD[sq].rent[0] * 2;
        } else {
            rent = BOARD[sq].rent[houses];
        }

        totalEPT += prob * rent * opponents;
    }

    return totalEPT;
}

/**
 * Get house cost for a color group
 */
function getHouseCost(group) {
    const firstSquare = COLOR_GROUPS[group].squares[0];
    return BOARD[firstSquare].housePrice;
}

/**
 * Get number of properties in a group
 */
function getGroupSize(group) {
    return COLOR_GROUPS[group].squares.length;
}

/**
 * Model the EPT growth curve for a monopoly
 *
 * Returns an array of {turn, cash, houses, ept, cumulativeEarnings}
 * showing the investment schedule
 *
 * @param group - Color group
 * @param startingCash - Cash available after trade
 * @param opponents - Number of opponents
 * @param maxTurns - How far to project
 */
function modelGrowthCurve(group, startingCash, opponents, maxTurns = 60) {
    const houseCost = getHouseCost(group);
    const groupSize = getGroupSize(group);
    const costPerLevel = houseCost * groupSize;  // Cost to add 1 house to all properties

    const timeline = [];
    let cash = startingCash;
    let houses = 0;  // Houses per property
    let cumulativeEarnings = 0;

    for (let turn = 0; turn <= maxTurns; turn++) {
        const ept = calculateGroupEPT(group, houses, opponents);

        timeline.push({
            turn,
            cash: Math.floor(cash),
            houses,
            ept: ept.toFixed(2),
            cumulativeEarnings: Math.floor(cumulativeEarnings)
        });

        // Earn EPT this turn
        cash += ept;
        cumulativeEarnings += ept;

        // Buy houses if we can afford them (build evenly rule)
        // Can only add one level at a time across all properties
        while (houses < 5 && cash >= costPerLevel) {
            cash -= costPerLevel;
            houses++;
        }
    }

    return timeline;
}

/**
 * Calculate the Net Present Value of a monopoly's growth curve
 *
 * This accounts for the TIME it takes to develop, not just the final EPT
 *
 * @param group - Color group
 * @param startingCash - Cash available after trade
 * @param opponents - Number of opponents
 * @param discountRate - Per-turn discount rate
 * @param maxTurns - Projection horizon
 */
function calculateGrowthNPV(group, startingCash, opponents, discountRate = 0.02, maxTurns = 50) {
    const curve = modelGrowthCurve(group, startingCash, opponents, maxTurns);

    let npv = 0;
    for (let t = 1; t < curve.length; t++) {
        const ept = parseFloat(curve[t].ept);
        // Discount factor: 1 / (1 + r)^t
        const discountFactor = 1 / Math.pow(1 + discountRate, t);
        npv += ept * discountFactor;
    }

    return npv;
}

/**
 * Compare growth curves of different color groups
 */
function compareGroups(startingCash, opponents) {
    const groups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

    const results = [];

    for (const group of groups) {
        const curve = modelGrowthCurve(group, startingCash, opponents, 50);
        const houseCost = getHouseCost(group);
        const groupSize = getGroupSize(group);

        // Find key milestones
        const at3Houses = curve.find(c => c.houses >= 3);
        const turnsTo3H = at3Houses ? at3Houses.turn : '>50';

        // EPT at various points
        const ept0 = parseFloat(curve[0].ept);
        const ept3H = parseFloat(curve.find(c => c.houses >= 3)?.ept || curve[curve.length-1].ept);

        // NPV with 2% discount rate
        const npv = calculateGrowthNPV(group, startingCash, opponents, 0.02, 50);

        results.push({
            group,
            houseCost,
            groupSize,
            totalCostTo3H: houseCost * groupSize * 3,
            eptAt0H: ept0.toFixed(1),
            eptAt3H: ept3H.toFixed(1),
            turnsTo3H,
            npv: Math.floor(npv)
        });
    }

    return results;
}

// =============================================================================
// DEMONSTRATION
// =============================================================================

console.log('='.repeat(70));
console.log('EPT GROWTH MODEL');
console.log('='.repeat(70));

console.log('\n--- ORANGE MONOPOLY GROWTH CURVE ---');
console.log('Starting cash: $500, 3 opponents\n');

const orangeCurve = modelGrowthCurve('orange', 500, 3, 30);
console.log('Turn  Cash   Houses  EPT     Cumulative');
console.log('-'.repeat(45));
for (const point of orangeCurve.filter((_, i) => i % 3 === 0 || i < 10)) {
    console.log(
        String(point.turn).padStart(4) +
        String('$' + point.cash).padStart(7) +
        String(point.houses).padStart(8) +
        String('$' + point.ept).padStart(8) +
        String('$' + point.cumulativeEarnings).padStart(12)
    );
}

console.log('\n--- DARK BLUE MONOPOLY GROWTH CURVE ---');
console.log('Starting cash: $500, 3 opponents\n');

const blueCurve = modelGrowthCurve('darkBlue', 500, 3, 30);
console.log('Turn  Cash   Houses  EPT     Cumulative');
console.log('-'.repeat(45));
for (const point of blueCurve.filter((_, i) => i % 3 === 0 || i < 10)) {
    console.log(
        String(point.turn).padStart(4) +
        String('$' + point.cash).padStart(7) +
        String(point.houses).padStart(8) +
        String('$' + point.ept).padStart(8) +
        String('$' + point.cumulativeEarnings).padStart(12)
    );
}

console.log('\n' + '='.repeat(70));
console.log('COMPARISON: All Groups with $500 starting cash, 3 opponents');
console.log('='.repeat(70) + '\n');

const comparison = compareGroups(500, 3);

console.log(
    'Group'.padEnd(12) +
    'Cost/H'.padStart(8) +
    'Cost→3H'.padStart(10) +
    'EPT@0H'.padStart(9) +
    'EPT@3H'.padStart(9) +
    'Turns→3H'.padStart(10) +
    'NPV'.padStart(8)
);
console.log('-'.repeat(70));

for (const r of comparison) {
    console.log(
        r.group.padEnd(12) +
        ('$' + r.houseCost).padStart(8) +
        ('$' + r.totalCostTo3H).padStart(10) +
        ('$' + r.eptAt0H).padStart(9) +
        ('$' + r.eptAt3H).padStart(9) +
        String(r.turnsTo3H).padStart(10) +
        ('$' + r.npv).padStart(8)
    );
}

console.log('\n' + '='.repeat(70));
console.log('KEY INSIGHTS');
console.log('='.repeat(70));

// Find which group has best NPV
const bestNPV = comparison.reduce((a, b) => a.npv > b.npv ? a : b);
const fastestTo3H = comparison.reduce((a, b) =>
    (typeof a.turnsTo3H === 'number' && typeof b.turnsTo3H === 'number')
        ? (a.turnsTo3H < b.turnsTo3H ? a : b)
        : (typeof a.turnsTo3H === 'number' ? a : b)
);

console.log(`
With $500 starting cash and 3 opponents:

Best NPV: ${bestNPV.group.toUpperCase()} ($${bestNPV.npv})
  - Despite not having highest EPT@3H, faster development means
    earlier earnings compound more

Fastest to 3 Houses: ${fastestTo3H.group.toUpperCase()} (${fastestTo3H.turnsTo3H} turns)
  - Lower house costs = faster development = earlier high EPT

This explains the ORANGE > DARK BLUE preference:
  - Orange: $100/house × 3 props × 3 houses = $900 to develop
  - Dark Blue: $200/house × 2 props × 3 houses = $1200 to develop
  - Orange reaches 3 houses FASTER, starts earning big sooner

The growth model shows that DEVELOPMENT SPEED matters as much as
final EPT. A cheap-to-develop monopoly can out-earn an expensive
one over the course of a game.
`);

// Compare different starting cash scenarios
console.log('='.repeat(70));
console.log('IMPACT OF STARTING CASH ON NPV');
console.log('='.repeat(70));
console.log('\nOrange monopoly NPV at different cash levels:\n');

for (const cash of [0, 250, 500, 750, 1000]) {
    const npv = calculateGrowthNPV('orange', cash, 3, 0.02, 50);
    const curve = modelGrowthCurve('orange', cash, 3, 50);
    const at3H = curve.find(c => c.houses >= 3);
    const turnsTo3H = at3H ? at3H.turn : '>50';

    console.log(`  $${cash} starting: NPV=$${Math.floor(npv)}, Turns to 3H: ${turnsTo3H}`);
}

console.log(`
This shows why CASH AFTER TRADE matters:
- More cash = faster development = higher NPV
- A trade that leaves you cash-poor delays development
- The "fair price" depends on how much cash you have LEFT
`);

module.exports = {
    calculateGroupEPT,
    modelGrowthCurve,
    calculateGrowthNPV,
    compareGroups
};
