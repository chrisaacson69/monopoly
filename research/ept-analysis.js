/**
 * Comprehensive EPT (Earnings Per Turn) Analysis
 *
 * Generates complete EPT tables for all properties at all development levels:
 * - Own only (no monopoly)
 * - Own with monopoly (0 houses, double rent)
 * - 1 house through 4 houses
 * - Hotel (5 houses)
 *
 * For both jail strategies:
 * - "Long Stay" (stay in jail, try to roll doubles)
 * - "Short Stay" (pay $50 immediately)
 */

const MonopolyMarkov = require('./markov-engine.js');
const PropertyValuator = require('./property-valuator.js');

// Initialize engines
console.log('================================================================================');
console.log('COMPREHENSIVE EPT (EARNINGS PER TURN) ANALYSIS');
console.log('================================================================================\n');

const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

const valuator = new PropertyValuator.Valuator(markov);
valuator.initialize();

// Get probabilities for both strategies
const probStay = markov.getAllProbabilities('stay');
const probLeave = markov.getAllProbabilities('leave');

// Development level labels
const DEV_LEVELS = ['Own', 'Monopoly', '1 House', '2 Houses', '3 Houses', '4 Houses', 'Hotel'];

// =============================================================================
// SECTION 1: EPT by Property (Long Stay Strategy)
// =============================================================================

console.log('\n================================================================================');
console.log('EPT BY PROPERTY - LONG STAY (Stay in Jail) Strategy');
console.log('================================================================================\n');

console.log('Development Levels: Own = single property, Monopoly = full set (2x rent), 1-4 Houses, Hotel');
console.log('');

// Group properties by color
const groups = [
    { name: 'BROWN', color: 'brown', squares: [1, 3] },
    { name: 'LIGHT BLUE', color: 'lightBlue', squares: [6, 8, 9] },
    { name: 'PINK', color: 'pink', squares: [11, 13, 14] },
    { name: 'ORANGE', color: 'orange', squares: [16, 18, 19] },
    { name: 'RED', color: 'red', squares: [21, 23, 24] },
    { name: 'YELLOW', color: 'yellow', squares: [26, 27, 29] },
    { name: 'GREEN', color: 'green', squares: [31, 32, 34] },
    { name: 'DARK BLUE', color: 'darkBlue', squares: [37, 39] }
];

function formatEPT(val) {
    return '$' + val.toFixed(2).padStart(7);
}

function printPropertyTable(probs, title) {
    console.log(`\n${title}`);
    console.log('─'.repeat(110));
    console.log('Property'.padEnd(24) + 'P(Land)'.padStart(8) +
                'Own'.padStart(9) + 'Monopoly'.padStart(9) +
                '1 House'.padStart(9) + '2 Houses'.padStart(9) +
                '3 Houses'.padStart(9) + '4 Houses'.padStart(9) +
                'Hotel'.padStart(9));
    console.log('─'.repeat(110));

    for (const group of groups) {
        console.log(`\n${group.name}:`);

        for (const sq of group.squares) {
            const prop = PropertyValuator.PROPERTIES[sq];
            if (!prop) continue;

            const prob = probs[sq];
            const name = prop.name.substring(0, 22).padEnd(24);
            const probStr = (prob * 100).toFixed(2) + '%';

            // Calculate EPT at each level
            const eptOwn = PropertyValuator.calculatePropertyEPT(sq, prob, 0, false);
            const eptMono = PropertyValuator.calculatePropertyEPT(sq, prob, 0, true);
            const ept1 = PropertyValuator.calculatePropertyEPT(sq, prob, 1, true);
            const ept2 = PropertyValuator.calculatePropertyEPT(sq, prob, 2, true);
            const ept3 = PropertyValuator.calculatePropertyEPT(sq, prob, 3, true);
            const ept4 = PropertyValuator.calculatePropertyEPT(sq, prob, 4, true);
            const eptH = PropertyValuator.calculatePropertyEPT(sq, prob, 5, true);

            console.log(name + probStr.padStart(8) +
                        formatEPT(eptOwn) + formatEPT(eptMono) +
                        formatEPT(ept1) + formatEPT(ept2) +
                        formatEPT(ept3) + formatEPT(ept4) +
                        formatEPT(eptH));
        }
    }
    console.log('─'.repeat(110));
}

printPropertyTable(probStay, 'LONG STAY Strategy (Stay in Jail)');

// =============================================================================
// SECTION 2: EPT by Property (Short Stay Strategy)
// =============================================================================

console.log('\n================================================================================');
console.log('EPT BY PROPERTY - SHORT STAY (Leave Jail) Strategy');
console.log('================================================================================');

printPropertyTable(probLeave, 'SHORT STAY Strategy (Pay $50 to Leave Jail)');

// =============================================================================
// SECTION 3: Strategy Comparison
// =============================================================================

console.log('\n================================================================================');
console.log('JAIL STRATEGY COMPARISON (EPT Difference: Long Stay - Short Stay)');
console.log('================================================================================\n');

console.log('Positive = Long Stay earns MORE  |  Negative = Short Stay earns MORE\n');
console.log('Property'.padEnd(24) + 'ΔP(Land)'.padStart(9) +
            'ΔOwn'.padStart(9) + 'ΔMonopoly'.padStart(10) +
            'Δ3 Houses'.padStart(10) + 'ΔHotel'.padStart(9));
console.log('─'.repeat(75));

for (const group of groups) {
    console.log(`\n${group.name}:`);

    for (const sq of group.squares) {
        const prop = PropertyValuator.PROPERTIES[sq];
        if (!prop) continue;

        const name = prop.name.substring(0, 22).padEnd(24);

        const deltaP = (probStay[sq] - probLeave[sq]) * 100;
        const deltaOwn = PropertyValuator.calculatePropertyEPT(sq, probStay[sq], 0, false) -
                         PropertyValuator.calculatePropertyEPT(sq, probLeave[sq], 0, false);
        const deltaMono = PropertyValuator.calculatePropertyEPT(sq, probStay[sq], 0, true) -
                          PropertyValuator.calculatePropertyEPT(sq, probLeave[sq], 0, true);
        const delta3 = PropertyValuator.calculatePropertyEPT(sq, probStay[sq], 3, true) -
                       PropertyValuator.calculatePropertyEPT(sq, probLeave[sq], 3, true);
        const deltaH = PropertyValuator.calculatePropertyEPT(sq, probStay[sq], 5, true) -
                       PropertyValuator.calculatePropertyEPT(sq, probLeave[sq], 5, true);

        const sign = (v) => v >= 0 ? '+' : '';

        console.log(name +
                    (sign(deltaP) + deltaP.toFixed(3) + '%').padStart(9) +
                    (sign(deltaOwn) + '$' + deltaOwn.toFixed(2)).padStart(9) +
                    (sign(deltaMono) + '$' + deltaMono.toFixed(2)).padStart(10) +
                    (sign(delta3) + '$' + delta3.toFixed(2)).padStart(10) +
                    (sign(deltaH) + '$' + deltaH.toFixed(2)).padStart(9));
    }
}

// =============================================================================
// SECTION 4: Group Totals
// =============================================================================

console.log('\n\n================================================================================');
console.log('COLOR GROUP EPT TOTALS (Long Stay Strategy)');
console.log('================================================================================\n');

console.log('Group'.padEnd(12) + 'Monopoly'.padStart(10) + '1 House'.padStart(10) +
            '2 Houses'.padStart(10) + '3 Houses'.padStart(10) +
            '4 Houses'.padStart(10) + 'Hotel'.padStart(10));
console.log('─'.repeat(72));

for (const group of groups) {
    let eptMono = 0, ept1 = 0, ept2 = 0, ept3 = 0, ept4 = 0, eptH = 0;

    for (const sq of group.squares) {
        const prob = probStay[sq];
        eptMono += PropertyValuator.calculatePropertyEPT(sq, prob, 0, true);
        ept1 += PropertyValuator.calculatePropertyEPT(sq, prob, 1, true);
        ept2 += PropertyValuator.calculatePropertyEPT(sq, prob, 2, true);
        ept3 += PropertyValuator.calculatePropertyEPT(sq, prob, 3, true);
        ept4 += PropertyValuator.calculatePropertyEPT(sq, prob, 4, true);
        eptH += PropertyValuator.calculatePropertyEPT(sq, prob, 5, true);
    }

    console.log(group.name.padEnd(12) +
                formatEPT(eptMono) + formatEPT(ept1) +
                formatEPT(ept2) + formatEPT(ept3) +
                formatEPT(ept4) + formatEPT(eptH));
}

// =============================================================================
// SECTION 5: Investment & ROI Analysis
// =============================================================================

console.log('\n\n================================================================================');
console.log('INVESTMENT & ROI ANALYSIS (Long Stay, 3 Houses)');
console.log('================================================================================\n');

console.log('Group'.padEnd(12) + 'Prop Cost'.padStart(10) + 'House Cost'.padStart(11) +
            'Total Inv'.padStart(10) + 'Total EPT'.padStart(10) +
            'ROI/Turn'.padStart(10) + 'Payback'.padStart(10));
console.log('─'.repeat(73));

const groupData = [];

for (const group of groups) {
    let propCost = 0, houseCost = 0, totalEPT = 0;

    for (const sq of group.squares) {
        const prop = PropertyValuator.PROPERTIES[sq];
        propCost += prop.price;
        houseCost += prop.housePrice * 3;  // 3 houses each
        totalEPT += PropertyValuator.calculatePropertyEPT(sq, probStay[sq], 3, true);
    }

    const totalInv = propCost + houseCost;
    const roi = totalEPT / totalInv * 100;
    const payback = totalInv / totalEPT;

    groupData.push({ name: group.name, propCost, houseCost, totalInv, totalEPT, roi, payback });

    console.log(group.name.padEnd(12) +
                ('$' + propCost).padStart(10) +
                ('$' + houseCost).padStart(11) +
                ('$' + totalInv).padStart(10) +
                formatEPT(totalEPT) +
                (roi.toFixed(2) + '%').padStart(10) +
                (payback.toFixed(1) + ' turns').padStart(10));
}

// Sort by ROI
groupData.sort((a, b) => b.roi - a.roi);

console.log('\n\nRANKING BY ROI (Best Investment Returns):');
console.log('─'.repeat(50));
let rank = 1;
for (const g of groupData) {
    console.log(`${rank}. ${g.name.padEnd(12)} ROI: ${g.roi.toFixed(2)}%  Payback: ${g.payback.toFixed(1)} turns`);
    rank++;
}

// =============================================================================
// SECTION 6: Railroads & Utilities
// =============================================================================

console.log('\n\n================================================================================');
console.log('RAILROADS & UTILITIES EPT');
console.log('================================================================================\n');

console.log('RAILROADS (Long Stay):');
console.log('─'.repeat(70));
console.log('Railroad'.padEnd(24) + 'P(Land)'.padStart(8) +
            '1 RR'.padStart(10) + '2 RRs'.padStart(10) +
            '3 RRs'.padStart(10) + '4 RRs'.padStart(10));
console.log('─'.repeat(70));

const rrSquares = [5, 15, 25, 35];
for (const sq of rrSquares) {
    const rr = PropertyValuator.RAILROADS[sq];
    const prob = probStay[sq];

    console.log(rr.name.padEnd(24) +
                ((prob * 100).toFixed(2) + '%').padStart(8) +
                formatEPT(PropertyValuator.calculateRailroadEPT(sq, prob, 1)) +
                formatEPT(PropertyValuator.calculateRailroadEPT(sq, prob, 2)) +
                formatEPT(PropertyValuator.calculateRailroadEPT(sq, prob, 3)) +
                formatEPT(PropertyValuator.calculateRailroadEPT(sq, prob, 4)));
}

// Total railroad EPT with all 4
let totalRR4 = 0;
for (const sq of rrSquares) {
    totalRR4 += PropertyValuator.calculateRailroadEPT(sq, probStay[sq], 4);
}
console.log('─'.repeat(70));
console.log('TOTAL (4 RRs)'.padEnd(24) + ''.padStart(8) +
            ''.padStart(10) + ''.padStart(10) +
            ''.padStart(10) + formatEPT(totalRR4));
console.log(`Investment: $800  |  ROI: ${(totalRR4/800*100).toFixed(2)}%  |  Payback: ${(800/totalRR4).toFixed(1)} turns`);

console.log('\n\nUTILITIES (Long Stay):');
console.log('─'.repeat(50));
console.log('Utility'.padEnd(20) + 'P(Land)'.padStart(8) +
            '1 Util'.padStart(10) + '2 Utils'.padStart(10));
console.log('─'.repeat(50));

const utilSquares = [12, 28];
for (const sq of utilSquares) {
    const util = PropertyValuator.UTILITIES[sq];
    const prob = probStay[sq];

    console.log(util.name.padEnd(20) +
                ((prob * 100).toFixed(2) + '%').padStart(8) +
                formatEPT(PropertyValuator.calculateUtilityEPT(sq, prob, 1)) +
                formatEPT(PropertyValuator.calculateUtilityEPT(sq, prob, 2)));
}

let totalUtil2 = 0;
for (const sq of utilSquares) {
    totalUtil2 += PropertyValuator.calculateUtilityEPT(sq, probStay[sq], 2);
}
console.log('─'.repeat(50));
console.log('TOTAL (2 Utils)'.padEnd(20) + ''.padStart(8) +
            ''.padStart(10) + formatEPT(totalUtil2));
console.log(`Investment: $300  |  ROI: ${(totalUtil2/300*100).toFixed(2)}%  |  Payback: ${(300/totalUtil2).toFixed(1)} turns`);

// =============================================================================
// SECTION 7: Best House Investments
// =============================================================================

console.log('\n\n================================================================================');
console.log('MARGINAL ROI: Best House Investments');
console.log('================================================================================\n');

console.log('This shows the return on investment for each house purchase.');
console.log('Higher marginal ROI = better investment for that specific house.\n');

const investments = valuator.getBestHouseInvestments('stay');

console.log('Property'.padEnd(24) + 'Level'.padStart(8) + 'Cost'.padStart(8) +
            'EPT Gain'.padStart(10) + 'Marg ROI'.padStart(10));
console.log('─'.repeat(62));

// Show top 20
for (let i = 0; i < Math.min(20, investments.length); i++) {
    const inv = investments[i];
    const levelStr = `${inv.fromHouses}→${inv.toHouses}`;
    console.log(inv.name.substring(0, 22).padEnd(24) +
                levelStr.padStart(8) +
                ('$' + inv.cost).padStart(8) +
                formatEPT(inv.eptIncrease) +
                (inv.marginalROI * 100).toFixed(2).padStart(9) + '%');
}

console.log('\n\nKEY INSIGHTS:');
console.log('─'.repeat(60));
console.log('• 3rd house typically provides best marginal ROI');
console.log('• Orange properties offer best overall ROI');
console.log('• Dark Blue has highest raw EPT but lower ROI');
console.log('• Brown/Light Blue are weak investments');

console.log('\n================================================================================');
console.log('ANALYSIS COMPLETE');
console.log('================================================================================\n');
