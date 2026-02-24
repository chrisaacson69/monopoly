/**
 * Cash Reserve Theory Analysis
 *
 * Derives optimal cash reserves from game state instead of fudge factors.
 * The optimal reserve balances two costs:
 *   1. Expected liquidation cost: P(landing on expensive rent) × shortfall × 2
 *      (houses sell at 50%, so shortfall costs 2x to cover)
 *   2. Opportunity cost: cash held as reserve = houses not built = EPT foregone
 *
 * Compare theoretical optimal to the static fudge factors:
 *   absoluteMinCash: $75, maxDebtRatio: 15%, maxAbsoluteDebt: $400
 */

'use strict';

const { MarkovEngine } = require('../../ai/markov-engine.js');
const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

const m = new MarkovEngine();
m.initialize();
const probs = m.getAllProbabilities();

const DICE_EPT = 38;

// ─── Core Theory Functions ───────────────────────────────────────────

/**
 * Compute expected rent you PAY per turn given opponent monopolies.
 * Returns { expectedOutflow, maxRent, exposures[] }
 */
function computeRentExposure(opponentGroups) {
    let expectedOutflow = 0;
    let maxRent = 0;
    const exposures = [];

    for (const { group, houses } of opponentGroups) {
        const squares = COLOR_GROUPS[group].squares;
        for (const sq of squares) {
            const rent = houses === 0
                ? BOARD[sq].rent[0] * 2  // monopoly, no houses
                : BOARD[sq].rent[houses];
            const p = probs[sq];
            expectedOutflow += p * rent;
            if (rent > maxRent) maxRent = rent;
            exposures.push({ sq, name: BOARD[sq].name, p, rent, group, houses });
        }
    }
    return { expectedOutflow, maxRent, exposures };
}

/**
 * Compute expected rent you RECEIVE per turn from your monopolies.
 */
function computeRentInflow(myGroups, numOpponents) {
    let expectedInflow = 0;
    for (const { group, houses } of myGroups) {
        const squares = COLOR_GROUPS[group].squares;
        for (const sq of squares) {
            const rent = houses === 0
                ? BOARD[sq].rent[0] * 2
                : BOARD[sq].rent[houses];
            expectedInflow += probs[sq] * rent * numOpponents;
        }
    }
    return expectedInflow;
}

/**
 * Expected liquidation cost if you hold reserve R.
 * When caught short (rent > R), you must sell houses at 50% loss.
 * E[cost] = Σ P(land_i) × max(0, rent_i - R) × 2
 */
function expectedLiquidationCost(reserve, exposures) {
    let cost = 0;
    for (const { p, rent } of exposures) {
        const shortfall = Math.max(0, rent - reserve);
        cost += p * shortfall * 2;  // 2x because 50% house sell penalty
    }
    return cost;
}

/**
 * Opportunity cost per turn of holding R dollars as reserve.
 * R dollars not invested = fractional house levels foregone = EPT lost.
 */
function opportunityCostPerTurn(reserve, group, numOpponents) {
    if (!group) return 0;
    const squares = COLOR_GROUPS[group].squares;
    const costPerLevel = BOARD[squares[0]].housePrice * squares.length;
    const levelsForegone = reserve / costPerLevel;

    // Marginal EPT per house level (use rent[3]-rent[2] as typical marginal)
    let marginalEPT = 0;
    for (const sq of squares) {
        const r = BOARD[sq].rent;
        // Average across level transitions that are still available
        const avgMarginal = (r[3] - r[2] + r[2] - r[1] + r[1] - r[0] * 2) / 3;
        marginalEPT += probs[sq] * Math.max(avgMarginal, r[1] - r[0]) * numOpponents;
    }

    return levelsForegone * marginalEPT;
}

/**
 * Find optimal reserve that minimizes total cost.
 */
function findOptimalReserve(exposures, myGroup, numOpponents, maxSearch = 2000) {
    let bestR = 0, minCost = Infinity, bestLiq = 0, bestOpp = 0;
    for (let R = 0; R <= maxSearch; R += 25) {
        const liq = expectedLiquidationCost(R, exposures);
        const opp = opportunityCostPerTurn(R, myGroup, numOpponents);
        const total = liq + opp;
        if (total < minCost) {
            minCost = total;
            bestR = R;
            bestLiq = liq;
            bestOpp = opp;
        }
    }
    return { optimalReserve: bestR, totalCost: minCost, liqCost: bestLiq, oppCost: bestOpp };
}

// ─── Scenarios ───────────────────────────────────────────────────────

console.log('='.repeat(80));
console.log('CASH RESERVE THEORY: Optimal Reserve vs Fudge Factors');
console.log('='.repeat(80));
console.log();
console.log('Static fudge factors: absoluteMinCash=$75, maxAbsoluteDebt=$400');
console.log();

const scenarios = [
    { name: 'Early: opp Orange 0H (monopoly, no houses)',
      opponent: [{group:'orange',houses:0}], my: [], opponents: 3 },
    { name: 'Mid: opp Orange 1H, I have Red 0H',
      opponent: [{group:'orange',houses:1}], my: [{group:'red',houses:0}], opponents: 3 },
    { name: 'Mid: opp Orange 2H, I have Red 1H',
      opponent: [{group:'orange',houses:2}], my: [{group:'red',houses:1}], opponents: 3 },
    { name: 'Mid: opp Orange 3H, I have Red 2H',
      opponent: [{group:'orange',houses:3}], my: [{group:'red',houses:2}], opponents: 3 },
    { name: 'Late: opp Orange 4H, I have Red 3H',
      opponent: [{group:'orange',houses:4}], my: [{group:'red',houses:3}], opponents: 3 },
    { name: 'Late: opp Green 3H, I have Orange 3H',
      opponent: [{group:'green',houses:3}], my: [{group:'orange',houses:3}], opponents: 3 },
    { name: 'Late: opp Green 3H + Red 3H, I have Orange 3H',
      opponent: [{group:'green',houses:3},{group:'red',houses:3}], my: [{group:'orange',houses:3}], opponents: 3 },
    { name: 'Endgame: opp Green 4H + Red 4H, I have Orange 4H (2 players left)',
      opponent: [{group:'green',houses:4},{group:'red',houses:4}], my: [{group:'orange',houses:4}], opponents: 2 },
    { name: '2-player: opp Orange Hotel, I have Green 3H',
      opponent: [{group:'orange',houses:5}], my: [{group:'green',houses:3}], opponents: 1 },
];

for (const sc of scenarios) {
    const { expectedOutflow, maxRent, exposures } = computeRentExposure(sc.opponent);
    const inflow = computeRentInflow(sc.my, sc.opponents);
    const netFlow = DICE_EPT + inflow - expectedOutflow;
    const myGroup = sc.my.length > 0 ? sc.my[0].group : null;
    const opt = findOptimalReserve(exposures, myGroup, sc.opponents);

    console.log('-'.repeat(80));
    console.log(sc.name);
    console.log('  Rent outflow (to them):  $' + expectedOutflow.toFixed(1) + '/turn');
    console.log('  Rent inflow (from them): $' + inflow.toFixed(1) + '/turn');
    console.log('  Net cash flow:           $' + netFlow.toFixed(1) + '/turn (incl $38 dice)');
    console.log('  Max single rent:         $' + maxRent);
    console.log('  OPTIMAL RESERVE:         $' + opt.optimalReserve);
    console.log('  Fudge factor:            $75');

    const delta = opt.optimalReserve - 75;
    if (delta > 0) {
        console.log('  --> Fudge UNDER-reserves by $' + delta + ' (risk!)');
    } else if (delta < 0) {
        console.log('  --> Fudge over-reserves by $' + (-delta) + ' (missed development)');
    } else {
        console.log('  --> Match');
    }
}

// ─── Reserve Curve: How optimal reserve scales with threat ───────────

console.log();
console.log('='.repeat(80));
console.log('RESERVE CURVE: Optimal reserve as opponent develops');
console.log('='.repeat(80));
console.log();

console.log('Threat (vs Red 3H)   MaxRent  Optimal  Fudge  Delta    E[liq]/t   Opp cost/t');
console.log('-'.repeat(80));

const threatGroups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'darkBlue', 'green'];
for (const tg of threatGroups) {
    for (const h of [3]) {
        const { maxRent, exposures } = computeRentExposure([{ group: tg, houses: h }]);
        const opt = findOptimalReserve(exposures, 'red', 3);
        const delta = opt.optimalReserve - 75;
        console.log(
            (tg + ' ' + h + 'H').padEnd(21) +
            ('$' + maxRent).padEnd(9) +
            ('$' + opt.optimalReserve).padEnd(9) +
            '$75'.padEnd(7) +
            ((delta >= 0 ? '+' : '') + '$' + delta).padEnd(9) +
            ('$' + opt.liqCost.toFixed(2)).padEnd(11) +
            '$' + opt.oppCost.toFixed(2)
        );
    }
}

console.log();
console.log('Orange development progression (vs Red 3H, 3 opponents):');
console.log('-'.repeat(80));
for (let h = 0; h <= 5; h++) {
    const { maxRent, exposures, expectedOutflow } = computeRentExposure([{ group: 'orange', houses: h }]);
    const opt = findOptimalReserve(exposures, 'red', 3);
    console.log(
        ('  Orange ' + (h === 5 ? 'Hotel' : h + 'H')).padEnd(18) +
        ('max=$' + maxRent).padEnd(12) +
        ('E[out]=$' + expectedOutflow.toFixed(1) + '/t').padEnd(18) +
        ('optimal=$' + opt.optimalReserve).padEnd(14) +
        'fudge=$75'
    );
}

console.log();
console.log('Green development progression (vs Orange 3H, 3 opponents):');
console.log('-'.repeat(80));
for (let h = 0; h <= 5; h++) {
    const { maxRent, exposures, expectedOutflow } = computeRentExposure([{ group: 'green', houses: h }]);
    const opt = findOptimalReserve(exposures, 'orange', 3);
    console.log(
        ('  Green ' + (h === 5 ? 'Hotel' : h + 'H')).padEnd(18) +
        ('max=$' + maxRent).padEnd(12) +
        ('E[out]=$' + expectedOutflow.toFixed(1) + '/t').padEnd(18) +
        ('optimal=$' + opt.optimalReserve).padEnd(14) +
        'fudge=$75'
    );
}

// ─── Multi-monopoly threat ──────────────────────────────────────────

console.log();
console.log('='.repeat(80));
console.log('MULTI-MONOPOLY THREAT: When opponents have 2+ monopolies');
console.log('='.repeat(80));
console.log();

const multiScenarios = [
    { name: '1 monopoly (Orange 3H)', threats: [{group:'orange',houses:3}] },
    { name: '2 monopolies (Orange+Red 3H)', threats: [{group:'orange',houses:3},{group:'red',houses:3}] },
    { name: '2 monopolies (Orange+Green 3H)', threats: [{group:'orange',houses:3},{group:'green',houses:3}] },
    { name: '3 monopolies (Org+Red+Grn 3H)', threats: [{group:'orange',houses:3},{group:'red',houses:3},{group:'green',houses:3}] },
];

for (const ms of multiScenarios) {
    const { maxRent, exposures, expectedOutflow } = computeRentExposure(ms.threats);
    const opt = findOptimalReserve(exposures, 'yellow', 3);
    console.log(
        ms.name.padEnd(40) +
        ('max=$' + maxRent).padEnd(11) +
        ('E[out]=$' + expectedOutflow.toFixed(1)).padEnd(14) +
        ('optimal=$' + opt.optimalReserve).padEnd(14) +
        'fudge=$75'
    );
}
