/**
 * Node.js test script for Monopoly Markov Engine
 * Run with: node test-markov.js
 */

const MonopolyMarkov = require('./markov-engine.js');
const PropertyValuator = require('./property-valuator.js');

// Published probabilities from various sources (Durango Bill, etc.)
// These are approximate values for "stay in jail" strategy
const PUBLISHED_PROBABILITIES = {
    0: 0.0309,   // GO
    1: 0.0215,   // Mediterranean
    2: 0.0183,   // Community Chest (after redirects)
    3: 0.0218,   // Baltic
    4: 0.0235,   // Income Tax
    5: 0.0290,   // Reading Railroad
    6: 0.0228,   // Oriental
    7: 0.0086,   // Chance (after redirects)
    8: 0.0243,   // Vermont
    9: 0.0243,   // Connecticut
    10: 0.0589,  // Jail (highest!)
    11: 0.0271,  // St. Charles
    12: 0.0264,  // Electric Company
    13: 0.0236,  // States
    14: 0.0252,  // Virginia
    15: 0.0287,  // Pennsylvania RR
    16: 0.0278,  // St. James
    17: 0.0268,  // Community Chest
    18: 0.0297,  // Tennessee
    19: 0.0311,  // New York
    20: 0.0289,  // Free Parking
    21: 0.0275,  // Kentucky
    22: 0.0107,  // Chance
    23: 0.0274,  // Indiana
    24: 0.0318,  // Illinois (highest property!)
    25: 0.0305,  // B&O Railroad
    26: 0.0268,  // Atlantic
    27: 0.0263,  // Ventnor
    28: 0.0279,  // Water Works
    29: 0.0260,  // Marvin Gardens
    30: 0.0000,  // Go to Jail (never end here)
    31: 0.0269,  // Pacific
    32: 0.0263,  // North Carolina
    33: 0.0248,  // Community Chest
    34: 0.0256,  // Pennsylvania Ave
    35: 0.0236,  // Short Line
    36: 0.0093,  // Chance
    37: 0.0224,  // Park Place
    38: 0.0214,  // Luxury Tax
    39: 0.0265   // Boardwalk
};

console.log('='.repeat(80));
console.log('MONOPOLY MARKOV CHAIN PROBABILITY ANALYSIS');
console.log('='.repeat(80));
console.log('');

// Initialize engine
console.log('Initializing Markov Engine...');
const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

// Verify matrix
console.log('\nVerifying transition matrix...');
const valid = markov.verifyMatrix();
console.log(valid ? '✓ Matrix is valid (all rows sum to 1)' : '✗ Matrix validation FAILED');

// Get probabilities
const probStay = markov.getAllProbabilities('stay');
const probLeave = markov.getAllProbabilities('leave');

// Verify sums
const sumStay = probStay.reduce((a, b) => a + b, 0);
const sumLeave = probLeave.reduce((a, b) => a + b, 0);
console.log(`\nProbability sums:`);
console.log(`  Stay in jail: ${sumStay.toFixed(8)} (should be 1.0)`);
console.log(`  Leave jail:   ${sumLeave.toFixed(8)} (should be 1.0)`);

// Top 10 most landed squares
console.log('\n' + '='.repeat(80));
console.log('TOP 10 MOST LANDED SQUARES (Stay in Jail Strategy)');
console.log('='.repeat(80));
const sorted = markov.getProbabilitiesSorted('stay');
console.log('\nRank  Square                        Probability');
console.log('-'.repeat(50));
for (let i = 0; i < 10; i++) {
    const rank = (i + 1).toString().padStart(2);
    const name = sorted[i].name.padEnd(28);
    const prob = (sorted[i].probability * 100).toFixed(3) + '%';
    console.log(`${rank}.   ${name} ${prob}`);
}

// Comparison with published values
console.log('\n' + '='.repeat(80));
console.log('COMPARISON WITH PUBLISHED VALUES');
console.log('='.repeat(80));
console.log('\nSquare                        Calculated  Published   Diff       Status');
console.log('-'.repeat(78));

let totalAbsDiff = 0;
let maxDiff = 0;
let maxDiffSquare = '';
let goodCount = 0;
let okCount = 0;
let reviewCount = 0;

for (let i = 0; i < 40; i++) {
    const name = MonopolyMarkov.getSquareName(i).padEnd(28);
    const calc = probStay[i];
    const pub = PUBLISHED_PROBABILITIES[i];
    const diff = calc - pub;
    const absDiff = Math.abs(diff);

    totalAbsDiff += absDiff;
    if (absDiff > maxDiff && i !== 30) {
        maxDiff = absDiff;
        maxDiffSquare = MonopolyMarkov.getSquareName(i);
    }

    const calcStr = (calc * 100).toFixed(3).padStart(7) + '%';
    const pubStr = (pub * 100).toFixed(3).padStart(7) + '%';
    const diffStr = ((diff >= 0 ? '+' : '') + (diff * 100).toFixed(4)).padStart(8) + '%';

    let status = '';
    if (absDiff < 0.002) { status = '✓ Good'; goodCount++; }
    else if (absDiff < 0.005) { status = '~ OK'; okCount++; }
    else { status = '✗ Review'; reviewCount++; }

    console.log(`${name} ${calcStr}   ${pubStr}   ${diffStr}   ${status}`);
}

console.log('-'.repeat(78));
console.log(`\nSummary:`);
console.log(`  Total absolute difference: ${(totalAbsDiff * 100).toFixed(4)}%`);
console.log(`  Average absolute difference: ${((totalAbsDiff / 40) * 100).toFixed(4)}%`);
console.log(`  Maximum difference: ${(maxDiff * 100).toFixed(4)}% (${maxDiffSquare})`);
console.log(`\n  Matches (diff < 0.2%): ${goodCount}/40`);
console.log(`  Acceptable (diff < 0.5%): ${okCount}/40`);
console.log(`  Need review (diff >= 0.5%): ${reviewCount}/40`);

// Show jail probability breakdown
console.log('\n' + '='.repeat(80));
console.log('JAIL STRATEGY COMPARISON');
console.log('='.repeat(80));
console.log('\nSquare                        Stay Jail   Leave Jail  Difference');
console.log('-'.repeat(65));

// Show top differences between strategies
const strategyDiffs = [];
for (let i = 0; i < 40; i++) {
    strategyDiffs.push({
        square: i,
        name: MonopolyMarkov.getSquareName(i),
        stay: probStay[i],
        leave: probLeave[i],
        diff: Math.abs(probStay[i] - probLeave[i])
    });
}
strategyDiffs.sort((a, b) => b.diff - a.diff);

for (let i = 0; i < 10; i++) {
    const item = strategyDiffs[i];
    const name = item.name.padEnd(28);
    const stay = (item.stay * 100).toFixed(3).padStart(7) + '%';
    const leave = (item.leave * 100).toFixed(3).padStart(7) + '%';
    const diff = ((item.stay - item.leave >= 0 ? '+' : '') + ((item.stay - item.leave) * 100).toFixed(4)).padStart(8) + '%';
    console.log(`${name} ${stay}    ${leave}    ${diff}`);
}

// EPT Analysis
console.log('\n' + '='.repeat(80));
console.log('EPT (EARNINGS PER TURN) ANALYSIS');
console.log('='.repeat(80));

const valuator = new PropertyValuator.Valuator(markov);
valuator.initialize();

const tables = valuator.getTables('stay');

console.log('\nProperty EPT at 3 Houses (optimal development):');
console.log('-'.repeat(60));
console.log('Property                   Probability  3-House Rent  EPT');
console.log('-'.repeat(60));

// Sort by EPT at 3 houses
const eptList = [];
for (const [sq, data] of Object.entries(tables.properties)) {
    eptList.push({
        square: parseInt(sq),
        name: data.name,
        prob: data.probability,
        rent: PropertyValuator.PROPERTIES[sq].rent[3],
        ept: data.ept.house3
    });
}
eptList.sort((a, b) => b.ept - a.ept);

for (const item of eptList) {
    const name = item.name.padEnd(25);
    const prob = (item.prob * 100).toFixed(2).padStart(6) + '%';
    const rent = ('$' + item.rent).padStart(7);
    const ept = '$' + item.ept.toFixed(3);
    console.log(`${name} ${prob}      ${rent}      ${ept}`);
}

// Group Rankings
console.log('\n' + '='.repeat(80));
console.log('COLOR GROUP RANKINGS (by ROI at 3 Houses)');
console.log('='.repeat(80));
console.log('\nRank  Group         Total EPT   Investment  ROI      Payback');
console.log('-'.repeat(65));

const rankings = valuator.getGroupRankings(3, 'stay');
rankings.forEach((r, i) => {
    const rank = (i + 1).toString().padStart(2);
    const group = r.group.padEnd(12);
    const ept = ('$' + r.ept.toFixed(3)).padStart(10);
    const inv = ('$' + r.investment).padStart(10);
    const roi = (r.roi * 100).toFixed(4).padStart(7) + '%';
    const payback = r.paybackTurns.toFixed(1).padStart(6) + ' turns';
    console.log(`${rank}.   ${group} ${ept}  ${inv}  ${roi}  ${payback}`);
});

// Best house investments
console.log('\n' + '='.repeat(80));
console.log('BEST HOUSE INVESTMENTS (by Marginal ROI)');
console.log('='.repeat(80));
console.log('\nProperty                  Level    Cost   EPT Gain  Marginal ROI');
console.log('-'.repeat(65));

const bestInv = valuator.getBestHouseInvestments('stay');
for (let i = 0; i < 15 && i < bestInv.length; i++) {
    const inv = bestInv[i];
    const name = inv.name.padEnd(24);
    const level = `${inv.fromHouses}→${inv.toHouses}`.padStart(5);
    const cost = ('$' + inv.cost).padStart(6);
    const eptGain = ('$' + inv.eptIncrease.toFixed(4)).padStart(9);
    const roi = (inv.marginalROI * 100).toFixed(4).padStart(9) + '%';
    console.log(`${name} ${level}  ${cost}  ${eptGain}  ${roi}`);
}

console.log('\n' + '='.repeat(80));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(80));
