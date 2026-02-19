/**
 * Test Roll EPT Calculator
 */

const MonopolyMarkov = require('./markov-engine.js');
const RollEPTCalculator = require('./roll-ept-calculator.js');

// Initialize Markov engine
console.log('Initializing Markov Engine...\n');
const markov = new MonopolyMarkov.MarkovEngine();
markov.initialize();

// Calculate baseline Roll EPT (start of game)
console.log('================================================================================');
console.log('ROLL EPT: Expected Income/Expense Per Turn From "Just Rolling"');
console.log('================================================================================\n');

const baseline = RollEPTCalculator.calculateRollEPT(markov, {
    netWorth: 1500,
    houseCount: 0,
    hotelCount: 0,
    playerCount: 4,
    jailStrategy: 'stay'
});

console.log('BASELINE (Start of Game):');
console.log('─'.repeat(50));
console.log(`  Net Worth: $1500, Houses: 0, Hotels: 0, Players: 4\n`);
console.log(`  TOTAL ROLL EPT: $${baseline.total.toFixed(2)} per turn\n`);
console.log('  Breakdown:');
console.log(`    Passing GO:       $${baseline.breakdown.passingGo.toFixed(2)}`);
console.log(`    Chance Cards:     $${baseline.breakdown.chanceCards.toFixed(2)}`);
console.log(`    Community Chest:  $${baseline.breakdown.communityChest.toFixed(2)}`);
console.log(`    Taxes:            $${baseline.breakdown.taxes.toFixed(2)}`);

console.log('\n  GO Details:');
console.log(`    P(pass GO from rolling): ${(baseline.details.go.fromRolling * 100).toFixed(2)}%`);
console.log(`    P(Advance to GO card):   ${(baseline.details.go.fromCards * 100).toFixed(2)}%`);
console.log(`    Expected GO income:      $${baseline.details.go.goIncome.toFixed(2)}`);

console.log('\n  Tax Details:');
console.log(`    P(Income Tax): ${(baseline.details.taxes.incomeTax.probability * 100).toFixed(2)}%`);
console.log(`    Income Tax amount: $${Math.abs(baseline.details.taxes.incomeTax.amount)} (10% of $1500 = $150, so use $150)`);
console.log(`    P(Luxury Tax): ${(baseline.details.taxes.luxuryTax.probability * 100).toFixed(2)}%`);

// Mid-game scenario
console.log('\n\n================================================================================');
console.log('MID-GAME SCENARIO');
console.log('================================================================================\n');

const midGame = RollEPTCalculator.calculateRollEPT(markov, {
    netWorth: 3000,
    houseCount: 6,
    hotelCount: 0,
    playerCount: 4,
    jailStrategy: 'stay'
});

console.log('MID-GAME (Net Worth $3000, 6 Houses):');
console.log('─'.repeat(50));
console.log(`  TOTAL ROLL EPT: $${midGame.total.toFixed(2)} per turn\n`);
console.log('  Breakdown:');
console.log(`    Passing GO:       $${midGame.breakdown.passingGo.toFixed(2)}`);
console.log(`    Chance Cards:     $${midGame.breakdown.chanceCards.toFixed(2)}`);
console.log(`    Community Chest:  $${midGame.breakdown.communityChest.toFixed(2)}`);
console.log(`    Taxes:            $${midGame.breakdown.taxes.toFixed(2)}`);

console.log('\n  Note: Chance/CC now negative due to Street Repairs risk');
console.log(`    Chance repairs (6 houses): $${6 * 25} per occurrence`);
console.log(`    CC repairs (6 houses): $${6 * 40} per occurrence`);

// Late-game scenario
console.log('\n\n================================================================================');
console.log('LATE-GAME SCENARIO');
console.log('================================================================================\n');

const lateGame = RollEPTCalculator.calculateRollEPT(markov, {
    netWorth: 5000,
    houseCount: 0,
    hotelCount: 6,
    playerCount: 3,  // One player eliminated
    jailStrategy: 'stay'
});

console.log('LATE-GAME (Net Worth $5000, 6 Hotels, 3 Players):');
console.log('─'.repeat(50));
console.log(`  TOTAL ROLL EPT: $${lateGame.total.toFixed(2)} per turn\n`);
console.log('  Breakdown:');
console.log(`    Passing GO:       $${lateGame.breakdown.passingGo.toFixed(2)}`);
console.log(`    Chance Cards:     $${lateGame.breakdown.chanceCards.toFixed(2)}`);
console.log(`    Community Chest:  $${lateGame.breakdown.communityChest.toFixed(2)}`);
console.log(`    Taxes:            $${lateGame.breakdown.taxes.toFixed(2)}`);

console.log('\n  Note: Heavy hotel penalty on Street Repairs!');
console.log(`    Chance repairs (6 hotels): $${6 * 100} per occurrence`);
console.log(`    CC repairs (6 hotels): $${6 * 115} per occurrence`);

// Sensitivity analysis
console.log('\n');
RollEPTCalculator.analyzeRollEPTSensitivity(markov);

console.log('\n================================================================================');
console.log('KEY INSIGHTS');
console.log('================================================================================\n');

console.log('1. BASELINE ROLL EPT is POSITIVE (~$' + baseline.total.toFixed(0) + '/turn)');
console.log('   - GO income dominates early game');
console.log('   - Card income slightly exceeds card expenses');
console.log('');
console.log('2. BUILDING HOUSES REDUCES ROLL EPT');
console.log('   - Street Repairs cards create liability');
console.log('   - 6 houses: Roll EPT drops by ~$' + (baseline.total - midGame.total).toFixed(0));
console.log('   - 6 hotels: Roll EPT drops by ~$' + (baseline.total - lateGame.total).toFixed(0));
console.log('');
console.log('3. NET WORTH > $2000 TRIGGERS HIGHER INCOME TAX');
console.log('   - Below $2000: pay 10% (less than $200)');
console.log('   - Above $2000: pay flat $200');
console.log('');
console.log('4. PLAYER COUNT MATTERS FOR SOME CARDS');
console.log('   - Chairman of Board: pay $50 × (players-1)');
console.log('   - Grand Opera Night: collect $50 × (players-1)');
console.log('   - Net effect roughly neutral');
