/**
 * Cash-Based Property Valuation
 *
 * Analyzes the EPT vs ROI trade-off when capital is limited.
 *
 * Key insight: ROI is the right metric when capital-constrained,
 * but EPT becomes more important as capital increases.
 *
 * Example: With $2000, should you:
 *   - Build 3 houses on Orange (cheaper, higher ROI)
 *   - Build 3 houses on Green (more expensive, higher EPT)
 *   - Split across both?
 */

const MonopolyMarkov = require('./markov-engine.js');
const PropertyValuator = require('./property-valuator.js');

// Initialize engines
console.log('================================================================================');
console.log('CASH-BASED PROPERTY VALUATION: EPT vs ROI Trade-offs');
console.log('================================================================================\n');

const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

const probs = markov.getAllProbabilities('stay');

// =============================================================================
// SECTION 1: Investment Requirements by Color Group
// =============================================================================

console.log('INVESTMENT REQUIREMENTS BY COLOR GROUP');
console.log('================================================================================\n');

const groups = [
    { name: 'Brown', color: 'brown', squares: [1, 3] },
    { name: 'Light Blue', color: 'lightBlue', squares: [6, 8, 9] },
    { name: 'Pink', color: 'pink', squares: [11, 13, 14] },
    { name: 'Orange', color: 'orange', squares: [16, 18, 19] },
    { name: 'Red', color: 'red', squares: [21, 23, 24] },
    { name: 'Yellow', color: 'yellow', squares: [26, 27, 29] },
    { name: 'Green', color: 'green', squares: [31, 32, 34] },
    { name: 'Dark Blue', color: 'darkBlue', squares: [37, 39] }
];

console.log('Group'.padEnd(12) + 'Properties'.padStart(11) +
            '3 Houses'.padStart(11) + '4 Houses'.padStart(11) +
            'Hotels'.padStart(11));
console.log('─'.repeat(56));

const groupData = [];

for (const group of groups) {
    let propCost = 0;
    let houseCost3 = 0;
    let houseCost4 = 0;
    let houseCost5 = 0;
    let ept3 = 0;
    let ept4 = 0;
    let ept5 = 0;

    for (const sq of group.squares) {
        const prop = PropertyValuator.PROPERTIES[sq];
        propCost += prop.price;
        houseCost3 += prop.housePrice * 3;
        houseCost4 += prop.housePrice * 4;
        houseCost5 += prop.housePrice * 5;

        ept3 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 3, true);
        ept4 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 4, true);
        ept5 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 5, true);
    }

    const total3 = propCost + houseCost3;
    const total4 = propCost + houseCost4;
    const total5 = propCost + houseCost5;

    groupData.push({
        name: group.name,
        color: group.color,
        propCost,
        total3,
        total4,
        total5,
        ept3,
        ept4,
        ept5,
        roi3: ept3 / total3,
        roi4: ept4 / total4,
        roi5: ept5 / total5
    });

    console.log(group.name.padEnd(12) +
                ('$' + propCost).padStart(11) +
                ('$' + total3).padStart(11) +
                ('$' + total4).padStart(11) +
                ('$' + total5).padStart(11));
}

console.log('─'.repeat(56));
console.log('\nNote: Above shows TOTAL cost (properties + houses) assuming you');
console.log('already own the monopoly. Add property costs if not yet owned.\n');

// =============================================================================
// SECTION 2: EPT and ROI Comparison
// =============================================================================

console.log('\n================================================================================');
console.log('EPT AND ROI COMPARISON (3 Houses on Each Property)');
console.log('================================================================================\n');

console.log('Group'.padEnd(12) + 'Total Inv'.padStart(11) +
            'EPT/Turn'.padStart(11) + 'ROI%'.padStart(9) +
            'Payback'.padStart(10));
console.log('─'.repeat(53));

// Sort by ROI for display
const byROI = [...groupData].sort((a, b) => b.roi3 - a.roi3);

for (const g of byROI) {
    const payback = (g.total3 / (g.ept3 * 3)).toFixed(0);  // 3 opponents
    console.log(g.name.padEnd(12) +
                ('$' + g.total3).padStart(11) +
                ('$' + g.ept3.toFixed(2)).padStart(11) +
                (g.roi3 * 100).toFixed(2).padStart(8) + '%' +
                (payback + ' turns').padStart(10));
}

console.log('\n(EPT is per opponent turn, Payback assumes 3 opponents)\n');

// =============================================================================
// SECTION 3: The Cash Trade-off Analysis
// =============================================================================

console.log('\n================================================================================');
console.log('CASH TRADE-OFF: Orange vs Green');
console.log('================================================================================\n');

const orange = groupData.find(g => g.color === 'orange');
const green = groupData.find(g => g.color === 'green');

console.log('HEAD-TO-HEAD COMPARISON:\n');
console.log('Metric'.padEnd(25) + 'ORANGE'.padStart(12) + 'GREEN'.padStart(12) + 'DIFFERENCE'.padStart(12));
console.log('─'.repeat(61));
console.log('Property Cost'.padEnd(25) +
            ('$' + orange.propCost).padStart(12) +
            ('$' + green.propCost).padStart(12) +
            ('$' + (green.propCost - orange.propCost)).padStart(12));
console.log('Cost for 3 Houses'.padEnd(25) +
            ('$' + orange.total3).padStart(12) +
            ('$' + green.total3).padStart(12) +
            ('$' + (green.total3 - orange.total3)).padStart(12));
console.log('EPT at 3 Houses'.padEnd(25) +
            ('$' + orange.ept3.toFixed(2)).padStart(12) +
            ('$' + green.ept3.toFixed(2)).padStart(12) +
            ('$' + (green.ept3 - orange.ept3).toFixed(2)).padStart(12));
console.log('ROI at 3 Houses'.padEnd(25) +
            (orange.roi3 * 100).toFixed(2).padStart(11) + '%' +
            (green.roi3 * 100).toFixed(2).padStart(11) + '%' +
            ((green.roi3 - orange.roi3) * 100).toFixed(2).padStart(11) + '%');

console.log('\n\nKEY INSIGHT:');
console.log('─'.repeat(61));
console.log(`Orange costs $${orange.total3} for 3 houses, earning $${orange.ept3.toFixed(2)}/turn`);
console.log(`Green costs $${green.total3} for 3 houses, earning $${green.ept3.toFixed(2)}/turn`);
console.log(`\nGreen costs $${green.total3 - orange.total3} MORE but earns $${(green.ept3 - orange.ept3).toFixed(2)}/turn MORE`);

const marginalInvestment = green.total3 - orange.total3;
const marginalEPT = green.ept3 - orange.ept3;
const marginalROI = marginalEPT / marginalInvestment;

console.log(`\nMARGINAL ROI of choosing Green over Orange: ${(marginalROI * 100).toFixed(2)}%`);

// =============================================================================
// SECTION 4: Cash Thresholds Analysis
// =============================================================================

console.log('\n\n================================================================================');
console.log('CASH THRESHOLD ANALYSIS');
console.log('================================================================================\n');

console.log('Given different cash amounts, what should you invest in?');
console.log('(Assuming you already own the properties and need to decide on houses)\n');

const cashLevels = [500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];

console.log('Cash'.padEnd(8) + 'Best Option'.padEnd(35) + 'EPT Earned'.padStart(12) + 'ROI%'.padStart(8));
console.log('─'.repeat(63));

for (const cash of cashLevels) {
    // Find best affordable option
    let bestOption = { name: 'Hold cash', ept: 0, roi: 0, cost: 0 };

    for (const g of groupData) {
        // Check each development level
        for (let houses = 1; houses <= 5; houses++) {
            let cost, ept;
            switch(houses) {
                case 1:
                case 2:
                    // Calculate on-the-fly
                    cost = g.propCost;
                    ept = 0;
                    for (const sq of groups.find(gr => gr.color === g.color).squares) {
                        const prop = PropertyValuator.PROPERTIES[sq];
                        cost += prop.housePrice * houses;
                        ept += PropertyValuator.calculatePropertyEPT(sq, probs[sq], houses, true);
                    }
                    break;
                case 3:
                    cost = g.total3;
                    ept = g.ept3;
                    break;
                case 4:
                    cost = g.total4;
                    ept = g.ept4;
                    break;
                case 5:
                    cost = g.total5;
                    ept = g.ept5;
                    break;
            }

            // Only building cost (assuming properties already owned)
            const buildingCost = cost - g.propCost;

            if (buildingCost <= cash && ept > bestOption.ept) {
                bestOption = {
                    name: `${g.name} ${houses}H`,
                    ept,
                    roi: ept / cost,
                    cost: buildingCost
                };
            }
        }
    }

    console.log(('$' + cash).padEnd(8) +
                bestOption.name.padEnd(35) +
                ('$' + bestOption.ept.toFixed(2)).padStart(12) +
                (bestOption.roi * 100).toFixed(2).padStart(7) + '%');
}

// =============================================================================
// SECTION 5: Opportunity Cost Analysis
// =============================================================================

console.log('\n\n================================================================================');
console.log('OPPORTUNITY COST: What If You Have $2000?');
console.log('================================================================================\n');

const cash = 2000;

console.log(`With $${cash} in cash, compare these strategies:\n`);

// Strategy 1: Build Orange to 3 houses
const orangeBuildCost = orange.total3 - orange.propCost;  // Just houses
const orangeRemaining = cash - orangeBuildCost;

// Strategy 2: Build Green to 3 houses
const greenBuildCost = green.total3 - green.propCost;  // Just houses
const greenRemaining = cash - greenBuildCost;

// Strategy 3: Build Orange to hotels
const orangeHotelBuildCost = orange.total5 - orange.propCost;
const orangeHotelRemaining = cash - orangeHotelBuildCost;

console.log('Strategy'.padEnd(30) + 'Cost'.padStart(8) + 'EPT'.padStart(10) +
            'Left'.padStart(8) + 'Effective ROI'.padStart(14));
console.log('─'.repeat(70));

// Calculate EPT values for different house levels
let orangeEpt1 = 0, orangeEpt2 = 0;
for (const sq of [16, 18, 19]) {
    orangeEpt1 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 1, true);
    orangeEpt2 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 2, true);
}

let greenEpt1 = 0, greenEpt2 = 0;
for (const sq of [31, 32, 34]) {
    greenEpt1 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 1, true);
    greenEpt2 += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 2, true);
}

console.log('Orange 3H (own props)'.padEnd(30) +
            ('$' + orangeBuildCost).padStart(8) +
            ('$' + orange.ept3.toFixed(2)).padStart(10) +
            ('$' + orangeRemaining).padStart(8) +
            ((orange.ept3 / orangeBuildCost * 100).toFixed(2) + '%').padStart(14));

console.log('Orange Hotels (own props)'.padEnd(30) +
            ('$' + orangeHotelBuildCost).padStart(8) +
            ('$' + orange.ept5.toFixed(2)).padStart(10) +
            ('$' + orangeHotelRemaining).padStart(8) +
            ((orange.ept5 / orangeHotelBuildCost * 100).toFixed(2) + '%').padStart(14));

console.log('Green 3H (own props)'.padEnd(30) +
            ('$' + greenBuildCost).padStart(8) +
            ('$' + green.ept3.toFixed(2)).padStart(10) +
            ('$' + greenRemaining).padStart(8) +
            ((green.ept3 / greenBuildCost * 100).toFixed(2) + '%').padStart(14));

// Mixed strategy: Orange 3H + something else with remainder
const mixedOrange3Green1Cost = orangeBuildCost + 600;  // 3 houses at $200 each for Green
if (mixedOrange3Green1Cost <= cash) {
    const mixedEPT = orange.ept3 + greenEpt1;
    console.log('Orange 3H + Green 1H'.padEnd(30) +
                ('$' + mixedOrange3Green1Cost).padStart(8) +
                ('$' + mixedEPT.toFixed(2)).padStart(10) +
                ('$' + (cash - mixedOrange3Green1Cost)).padStart(8) +
                ((mixedEPT / mixedOrange3Green1Cost * 100).toFixed(2) + '%').padStart(14));
}

// =============================================================================
// SECTION 6: The EPT Maximization Framework
// =============================================================================

console.log('\n\n================================================================================');
console.log('EPT MAXIMIZATION FRAMEWORK');
console.log('================================================================================\n');

console.log('PRINCIPLE: When capital is UNLIMITED, maximize EPT.');
console.log('           When capital is LIMITED, consider ROI.\n');

console.log('DECISION RULE:');
console.log('─'.repeat(60));
console.log('1. If you can fully develop your best ROI property AND have');
console.log('   leftover cash, consider if the leftover exceeds the cost');
console.log('   difference to a higher-EPT property.\n');

console.log('2. The "breakeven cash" to prefer Green over Orange:');
const breakeven = orange.total3 + (marginalInvestment);
console.log(`   You need at least $${breakeven} to justify Green 3H over Orange 3H`);
console.log(`   (Because Green costs $${green.total3}, Orange costs $${orange.total3})\n`);

console.log('3. BUT if you already have both monopolies, the question is:');
console.log('   "Which houses to build with my available cash?"\n');

// Calculate incremental house values
console.log('MARGINAL EPT PER HOUSE (ordered by return on that specific house):');
console.log('─'.repeat(60));

const allHouseInvestments = [];

for (const g of groupData) {
    const groupSquares = groups.find(gr => gr.color === g.color).squares;

    for (let level = 1; level <= 5; level++) {
        let prevEPT = 0;
        let currEPT = 0;
        let cost = 0;

        for (const sq of groupSquares) {
            const prop = PropertyValuator.PROPERTIES[sq];

            if (level === 1) {
                prevEPT += PropertyValuator.calculatePropertyEPT(sq, probs[sq], 0, true);
            } else {
                prevEPT += PropertyValuator.calculatePropertyEPT(sq, probs[sq], level - 1, true);
            }
            currEPT += PropertyValuator.calculatePropertyEPT(sq, probs[sq], level, true);
            cost += prop.housePrice;
        }

        const eptGain = currEPT - prevEPT;
        const margROI = eptGain / cost;

        allHouseInvestments.push({
            group: g.name,
            level: level === 5 ? 'Hotel' : `House ${level}`,
            cost,
            eptGain,
            margROI,
            cumulative: currEPT
        });
    }
}

// Sort by marginal ROI
allHouseInvestments.sort((a, b) => b.margROI - a.margROI);

console.log('Rank'.padEnd(5) + 'Group'.padEnd(12) + 'Level'.padEnd(10) +
            'Cost'.padStart(8) + 'EPT Gain'.padStart(11) + 'Marg ROI'.padStart(10));
console.log('─'.repeat(56));

for (let i = 0; i < Math.min(15, allHouseInvestments.length); i++) {
    const inv = allHouseInvestments[i];
    console.log((i + 1 + '.').padEnd(5) +
                inv.group.padEnd(12) +
                inv.level.padEnd(10) +
                ('$' + inv.cost).padStart(8) +
                ('$' + inv.eptGain.toFixed(2)).padStart(11) +
                ((inv.margROI * 100).toFixed(2) + '%').padStart(10));
}

// =============================================================================
// SECTION 7: Practical Decision Guide
// =============================================================================

console.log('\n\n================================================================================');
console.log('PRACTICAL DECISION GUIDE');
console.log('================================================================================\n');

console.log('GIVEN CASH ON HAND, OPTIMAL BUILDING ORDER:\n');

function getOptimalBuildOrder(maxCash) {
    const available = [...allHouseInvestments];
    const built = {};
    const order = [];
    let totalCash = 0;
    let totalEPT = 0;

    // Track current house level per group
    for (const g of groups) {
        built[g.name] = 0;
    }

    while (available.length > 0 && totalCash < maxCash) {
        // Find best investment that:
        // 1. We can afford
        // 2. Is the next level for that group

        let bestIdx = -1;
        let bestROI = -1;

        for (let i = 0; i < available.length; i++) {
            const inv = available[i];
            const currentLevel = built[inv.group];
            const targetLevel = inv.level === 'Hotel' ? 5 : parseInt(inv.level.split(' ')[1]);

            if (targetLevel === currentLevel + 1 &&
                totalCash + inv.cost <= maxCash &&
                inv.margROI > bestROI) {
                bestIdx = i;
                bestROI = inv.margROI;
            }
        }

        if (bestIdx === -1) break;

        const chosen = available[bestIdx];
        order.push(chosen);
        totalCash += chosen.cost;
        totalEPT += chosen.eptGain;

        const targetLevel = chosen.level === 'Hotel' ? 5 : parseInt(chosen.level.split(' ')[1]);
        built[chosen.group] = targetLevel;

        available.splice(bestIdx, 1);
    }

    return { order, totalCash, totalEPT };
}

for (const budget of [1000, 1500, 2000, 3000, 5000]) {
    const result = getOptimalBuildOrder(budget);

    console.log(`BUDGET: $${budget}`);
    console.log('─'.repeat(50));

    if (result.order.length === 0) {
        console.log('  Cannot afford any house upgrades');
    } else {
        for (const step of result.order) {
            console.log(`  ${step.group} ${step.level}: $${step.cost} → +$${step.eptGain.toFixed(2)}/turn`);
        }
        console.log(`  TOTAL: $${result.totalCash} spent, $${result.totalEPT.toFixed(2)}/turn earned`);
        console.log(`  Effective ROI: ${(result.totalEPT / result.totalCash * 100).toFixed(2)}%`);
    }
    console.log('');
}

console.log('\n================================================================================');
console.log('KEY TAKEAWAYS');
console.log('================================================================================\n');

console.log('1. ORANGE has the BEST ROI but GREEN has higher EPT at 3+ houses');
console.log('');
console.log('2. The 3rd house is typically the "sweet spot" for marginal ROI');
console.log('   (massive rent increase for the same house cost)');
console.log('');
console.log('3. With limited cash ($1000-$1500), focus on Orange/Red 3rd houses');
console.log('');
console.log('4. With more cash ($2000+), Green properties become attractive');
console.log('   because their higher EPT justifies the extra cost');
console.log('');
console.log('5. NEVER build past the point of diminishing returns unless');
console.log('   you have excess cash with no better alternatives');
console.log('');
console.log('6. 4th house and hotel have LOWER marginal ROI than 3rd house');
console.log('   - only worthwhile if opponent is cash-rich and you need');
console.log('     the knockout blow');
