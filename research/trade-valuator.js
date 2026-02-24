/**
 * Trade Valuator
 *
 * Calculates fair trade values based on EPT equalization.
 *
 * Key insight: A "fair" trade should give both parties equal EPT potential.
 * Since ROI varies by property group, the higher-ROI group commands a premium.
 *
 * Example: Trading Orange monopoly for Green monopoly
 * - Orange can achieve $50.86 EPT at 3 houses for $900 in building costs
 * - Green needs $1800 to achieve $73.16 EPT at 3 houses
 * - To equalize at Orange's EPT ($50.86), Green only needs ~$1200 in houses (2H)
 * - So the "premium" for Orange is the difference in required capital
 */

const MonopolyMarkov = require('../ai/markov-engine.js');
const PropertyValuator = require('../ai/property-valuator.js');

// Initialize engines
console.log('================================================================================');
console.log('TRADE VALUATOR: EPT-Based Fair Trade Calculator');
console.log('================================================================================\n');

const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

const probs = markov.getAllProbabilities('stay');

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const groups = {
    brown: { name: 'Brown', squares: [1, 3] },
    lightBlue: { name: 'Light Blue', squares: [6, 8, 9] },
    pink: { name: 'Pink', squares: [11, 13, 14] },
    orange: { name: 'Orange', squares: [16, 18, 19] },
    red: { name: 'Red', squares: [21, 23, 24] },
    yellow: { name: 'Yellow', squares: [26, 27, 29] },
    green: { name: 'Green', squares: [31, 32, 34] },
    darkBlue: { name: 'Dark Blue', squares: [37, 39] }
};

/**
 * Calculate EPT for a color group at a given house level (0-5)
 */
function getGroupEPT(color, houseLevel) {
    const group = groups[color];
    if (!group) return 0;

    let ept = 0;
    for (const sq of group.squares) {
        ept += PropertyValuator.calculatePropertyEPT(sq, probs[sq], houseLevel, true);
    }
    return ept;
}

/**
 * Calculate building cost (houses only) for a group at a given level
 */
function getBuildingCost(color, houseLevel) {
    const group = groups[color];
    if (!group) return 0;

    let cost = 0;
    for (const sq of group.squares) {
        const prop = PropertyValuator.PROPERTIES[sq];
        cost += prop.housePrice * houseLevel;
    }
    return cost;
}

/**
 * Calculate property cost (purchase price) for a group
 */
function getPropertyCost(color) {
    const group = groups[color];
    if (!group) return 0;

    let cost = 0;
    for (const sq of group.squares) {
        const prop = PropertyValuator.PROPERTIES[sq];
        cost += prop.price;
    }
    return cost;
}

/**
 * Find the minimum building cost to achieve a target EPT for a group
 * Returns { level, cost, ept } or null if not achievable
 */
function costToAchieveEPT(color, targetEPT) {
    const group = groups[color];
    if (!group) return null;

    // Check each development level
    for (let level = 0; level <= 5; level++) {
        const ept = getGroupEPT(color, level);
        if (ept >= targetEPT) {
            const cost = getBuildingCost(color, level);
            return { level, cost, ept, exceeds: ept - targetEPT };
        }
    }

    // Can't achieve target even at hotel level
    const maxEPT = getGroupEPT(color, 5);
    const maxCost = getBuildingCost(color, 5);
    return { level: 5, cost: maxCost, ept: maxEPT, shortfall: targetEPT - maxEPT };
}

/**
 * Calculate fractional building cost to achieve exact EPT
 * (interpolates between house levels)
 */
function exactCostForEPT(color, targetEPT) {
    const group = groups[color];
    if (!group) return null;

    // Get EPT at each level
    const eptByLevel = [];
    const costByLevel = [];
    for (let level = 0; level <= 5; level++) {
        eptByLevel.push(getGroupEPT(color, level));
        costByLevel.push(getBuildingCost(color, level));
    }

    // Find where target EPT falls
    for (let level = 0; level < 5; level++) {
        if (eptByLevel[level + 1] >= targetEPT && eptByLevel[level] < targetEPT) {
            // Target is between level and level+1
            const eptRange = eptByLevel[level + 1] - eptByLevel[level];
            const costRange = costByLevel[level + 1] - costByLevel[level];
            const fraction = (targetEPT - eptByLevel[level]) / eptRange;
            const interpolatedCost = costByLevel[level] + fraction * costRange;
            return {
                exactLevel: level + fraction,
                cost: interpolatedCost,
                ept: targetEPT
            };
        }
    }

    // Target is at or below level 0
    if (targetEPT <= eptByLevel[0]) {
        return { exactLevel: 0, cost: 0, ept: eptByLevel[0] };
    }

    // Target exceeds max
    return { exactLevel: 5, cost: costByLevel[5], ept: eptByLevel[5], shortfall: targetEPT - eptByLevel[5] };
}

// =============================================================================
// SECTION 1: EPT vs Building Cost Table
// =============================================================================

console.log('EPT vs BUILDING COST BY COLOR GROUP');
console.log('================================================================================\n');

console.log('(Building cost = houses only, assuming properties already owned)\n');

console.log('Group'.padEnd(12) + '0H(Mono)'.padStart(10) + '1H'.padStart(10) +
            '2H'.padStart(10) + '3H'.padStart(10) +
            '4H'.padStart(10) + '5H(Hotel)'.padStart(12));
console.log('─'.repeat(74));

for (const [color, group] of Object.entries(groups)) {
    const row = [group.name.padEnd(12)];
    for (let level = 0; level <= 5; level++) {
        const ept = getGroupEPT(color, level);
        row.push(('$' + ept.toFixed(2)).padStart(level === 5 ? 12 : 10));
    }
    console.log(row.join(''));
}

console.log('\nBuilding Costs:');
console.log('─'.repeat(74));

for (const [color, group] of Object.entries(groups)) {
    const row = [group.name.padEnd(12)];
    for (let level = 0; level <= 5; level++) {
        const cost = getBuildingCost(color, level);
        row.push(('$' + cost).padStart(level === 5 ? 12 : 10));
    }
    console.log(row.join(''));
}

// =============================================================================
// SECTION 2: Trade Example - Orange vs Green
// =============================================================================

console.log('\n\n================================================================================');
console.log('TRADE ANALYSIS: Orange vs Green');
console.log('================================================================================\n');

const orangeEPT3 = getGroupEPT('orange', 3);
const orangeCost3 = getBuildingCost('orange', 3);
const greenEPT3 = getGroupEPT('green', 3);
const greenCost3 = getBuildingCost('green', 3);

console.log('SCENARIO: You have Orange, opponent has Green. Both want 3 houses.\n');

console.log('At 3 Houses:');
console.log(`  Orange: EPT = $${orangeEPT3.toFixed(2)}, Building Cost = $${orangeCost3}`);
console.log(`  Green:  EPT = $${greenEPT3.toFixed(2)}, Building Cost = $${greenCost3}`);
console.log(`  Difference: Green earns $${(greenEPT3 - orangeEPT3).toFixed(2)} more but costs $${greenCost3 - orangeCost3} more\n`);

// Find what Green needs to match Orange's EPT
const greenToMatchOrange = exactCostForEPT('green', orangeEPT3);
console.log(`To match Orange's $${orangeEPT3.toFixed(2)} EPT:`);
console.log(`  Green needs ~${greenToMatchOrange.exactLevel.toFixed(2)} houses = $${greenToMatchOrange.cost.toFixed(0)} building cost`);
console.log(`  Orange premium = $${(orangeCost3 - greenToMatchOrange.cost).toFixed(0)} less capital needed\n`);

// Find what Orange needs to match Green's EPT
const orangeToMatchGreen = exactCostForEPT('orange', greenEPT3);
console.log(`To match Green's $${greenEPT3.toFixed(2)} EPT:`);
if (orangeToMatchGreen.shortfall) {
    console.log(`  Orange CANNOT reach this EPT (max at hotels: $${getGroupEPT('orange', 5).toFixed(2)})`);
    console.log(`  Green has $${orangeToMatchGreen.shortfall.toFixed(2)} higher EPT ceiling`);
} else {
    console.log(`  Orange needs ~${orangeToMatchGreen.exactLevel.toFixed(2)} houses = $${orangeToMatchGreen.cost.toFixed(0)} building cost`);
    console.log(`  But Green still costs $${greenCost3} (difference: $${greenCost3 - orangeToMatchGreen.cost.toFixed(0)})`);
}

// =============================================================================
// SECTION 3: Fair Trade Calculator
// =============================================================================

console.log('\n\n================================================================================');
console.log('FAIR TRADE CALCULATOR');
console.log('================================================================================\n');

console.log('A "fair" trade equalizes EPT potential given available cash.\n');

/**
 * Calculate the fair cash adjustment for a monopoly-for-monopoly trade
 * Positive result = group1 owner should receive cash
 * Negative result = group1 owner should pay cash
 *
 * @param {string} group1 - Color being given away
 * @param {string} group2 - Color being received
 * @param {number} targetLevel - Target development level (1-5)
 * @returns {Object} Trade analysis
 */
function calculateFairTrade(group1, group2, targetLevel) {
    const ept1 = getGroupEPT(group1, targetLevel);
    const cost1 = getBuildingCost(group1, targetLevel);

    const ept2 = getGroupEPT(group2, targetLevel);
    const cost2 = getBuildingCost(group2, targetLevel);

    // Method 1: EPT Differential
    // The ROI difference translates to a cash premium
    // If group1 has better ROI, it takes less cash to achieve same EPT

    // Find cost for group2 to match group1's EPT
    const group2ToMatch1 = exactCostForEPT(group2, ept1);

    // Find cost for group1 to match group2's EPT
    const group1ToMatch2 = exactCostForEPT(group1, ept2);

    return {
        group1: {
            name: groups[group1].name,
            ept: ept1,
            cost: cost1,
            roi: ept1 / cost1
        },
        group2: {
            name: groups[group2].name,
            ept: ept2,
            cost: cost2,
            roi: ept2 / cost2
        },
        atTargetLevel: targetLevel,
        // If trading group1 for group2:
        // - Group1 achieves EPT=$X for cost $A
        // - Group2 needs cost $B to achieve same EPT
        // - Fair trade: group1 owner gets cash = $B - $A
        fairCashToGroup1Owner: group2ToMatch1.cost - cost1,
        group2CostToMatchGroup1EPT: group2ToMatch1.cost,

        // Alternative: equalize at group2's EPT level
        group1CostToMatchGroup2EPT: group1ToMatch2.shortfall ? 'Cannot reach' : group1ToMatch2.cost,
        fairCashAtGroup2Level: group1ToMatch2.shortfall ? 'N/A' : cost2 - group1ToMatch2.cost
    };
}

// Calculate fair trades for common scenarios
const tradeScenarios = [
    ['orange', 'green', 3],
    ['orange', 'red', 3],
    ['orange', 'darkBlue', 3],
    ['red', 'green', 3],
    ['pink', 'orange', 3],
    ['lightBlue', 'orange', 3]
];

console.log('FAIR CASH ADJUSTMENTS (at 3 house development):\n');
console.log('Trade'.padEnd(25) + 'EPT Diff'.padStart(10) + 'Cost Diff'.padStart(11) +
            'Fair Cash'.padStart(11) + 'Direction'.padStart(12));
console.log('─'.repeat(69));

for (const [g1, g2, level] of tradeScenarios) {
    const trade = calculateFairTrade(g1, g2, level);

    const eptDiff = trade.group2.ept - trade.group1.ept;
    const costDiff = trade.group2.cost - trade.group1.cost;
    const fairCash = trade.fairCashToGroup1Owner;

    const direction = fairCash > 0 ? `${trade.group1.name} gets` :
                     fairCash < 0 ? `${trade.group2.name} gets` : 'Even';

    console.log(`${trade.group1.name} → ${trade.group2.name}`.padEnd(25) +
                (`$${eptDiff.toFixed(2)}`).padStart(10) +
                (`$${costDiff}`).padStart(11) +
                (`$${Math.abs(fairCash).toFixed(0)}`).padStart(11) +
                direction.padStart(12));
}

// =============================================================================
// SECTION 4: Detailed Orange vs Green Trade Analysis
// =============================================================================

console.log('\n\n================================================================================');
console.log('DETAILED ANALYSIS: Orange ↔ Green Trade');
console.log('================================================================================\n');

console.log('Scenario: Player A has Orange monopoly, Player B has Green monopoly.\n');
console.log('Both players want to maximize EPT. What\'s a fair trade?\n');

// At various EPT targets
console.log('EPT-EQUALIZED TRADE VALUES:\n');
console.log('Target EPT'.padEnd(14) + 'Orange Cost'.padStart(12) + 'Green Cost'.padStart(12) +
            'Difference'.padStart(12) + 'Who Pays'.padStart(12));
console.log('─'.repeat(62));

const eptTargets = [30, 40, 50, 60, 70, 80, 90];

for (const targetEPT of eptTargets) {
    const orangeResult = exactCostForEPT('orange', targetEPT);
    const greenResult = exactCostForEPT('green', targetEPT);

    const orangeCost = orangeResult.shortfall ? 'MAX' : `$${orangeResult.cost.toFixed(0)}`;
    const greenCost = greenResult.shortfall ? 'MAX' : `$${greenResult.cost.toFixed(0)}`;

    let diff = '';
    let whoPays = '';

    if (!orangeResult.shortfall && !greenResult.shortfall) {
        const cashDiff = greenResult.cost - orangeResult.cost;
        diff = `$${Math.abs(cashDiff).toFixed(0)}`;
        whoPays = cashDiff > 0 ? 'Green owner' : 'Orange owner';
    } else if (orangeResult.shortfall) {
        diff = 'N/A';
        whoPays = 'Unreachable';
    } else {
        diff = 'N/A';
        whoPays = 'Green max';
    }

    console.log((`$${targetEPT}/turn`).padEnd(14) +
                orangeCost.padStart(12) +
                greenCost.padStart(12) +
                diff.padStart(12) +
                whoPays.padStart(12));
}

console.log('\n"Green Cost" - "Orange Cost" = Cash Green owner should pay to Orange owner');
console.log('for the trade to be "fair" at that EPT level.\n');

// =============================================================================
// SECTION 5: Trade Premium Calculator
// =============================================================================

console.log('\n================================================================================');
console.log('TRADE PREMIUM: How Much is Orange "Worth" Over Green?');
console.log('================================================================================\n');

// The "premium" is how much extra value Orange provides due to better ROI
// This is the integral of the savings across all development levels

let totalSavings = 0;
console.log('Development'.padEnd(12) + 'Orange Cost'.padStart(12) + 'Green Cost'.padStart(12) +
            'Savings'.padStart(12) + 'Cumulative'.padStart(12));
console.log('─'.repeat(60));

for (let level = 1; level <= 5; level++) {
    const orangeCost = getBuildingCost('orange', level);
    const greenCost = getBuildingCost('green', level);
    const orangeEPT = getGroupEPT('orange', level);
    const greenEPT = getGroupEPT('green', level);

    // Find Green cost to achieve Orange's EPT at this level
    const greenToMatchOrange = exactCostForEPT('green', orangeEPT);
    const savings = greenToMatchOrange.cost - orangeCost;
    totalSavings += savings;

    const levelName = level === 5 ? 'Hotel' : `${level} House`;
    console.log(levelName.padEnd(12) +
                (`$${orangeCost}`).padStart(12) +
                (`$${greenToMatchOrange.cost.toFixed(0)}`).padStart(12) +
                (`$${savings.toFixed(0)}`).padStart(12) +
                (`$${totalSavings.toFixed(0)}`).padStart(12));
}

console.log('─'.repeat(60));
console.log(`TOTAL CAPITAL EFFICIENCY PREMIUM: $${totalSavings.toFixed(0)}`);
console.log('\nThis represents the cumulative savings from Orange\'s better ROI.');
console.log('A player trading away Orange for Green should demand ~$' +
            Math.round(totalSavings / 3) + '-$' + Math.round(totalSavings / 2) +
            ' cash premium');
console.log('(depending on how much development is expected).\n');

// =============================================================================
// SECTION 6: Practical Trade Guidelines
// =============================================================================

console.log('\n================================================================================');
console.log('PRACTICAL TRADE GUIDELINES');
console.log('================================================================================\n');

console.log('ORANGE TRADE PREMIUMS (what Orange owner should demand):\n');

const colorList = ['brown', 'lightBlue', 'pink', 'red', 'yellow', 'green', 'darkBlue'];

for (const otherColor of colorList) {
    const trade = calculateFairTrade('orange', otherColor, 3);
    const premium = trade.fairCashToGroup1Owner;

    if (premium > 0) {
        console.log(`  Orange → ${groups[otherColor].name.padEnd(12)}: demand +$${premium.toFixed(0)} cash`);
    } else if (premium < 0) {
        console.log(`  Orange → ${groups[otherColor].name.padEnd(12)}: pay $${Math.abs(premium).toFixed(0)} cash`);
    } else {
        console.log(`  Orange → ${groups[otherColor].name.padEnd(12)}: even trade`);
    }
}

console.log('\n\nKEY PRINCIPLES:\n');
console.log('1. Higher ROI properties command a CASH premium in trades');
console.log('   (because they achieve same EPT with less capital)\n');
console.log('2. The premium should equal the capital savings at target development\n');
console.log('3. "Fair" means both parties can achieve EQUAL EPT after the trade\n');
console.log('4. Properties with higher EPT CEILING may justify paying a premium');
console.log('   (Green can achieve $103 EPT, Orange maxes at $86.74)\n');
console.log('5. Consider BOTH players\' cash positions when negotiating');
console.log('   (A cash-rich player may prefer Green\'s higher EPT ceiling)\n');

console.log('\n================================================================================');
console.log('TRADE VALUATOR COMPLETE');
console.log('================================================================================\n');
