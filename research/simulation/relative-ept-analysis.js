/**
 * Relative EPT Analysis
 *
 * Key insight from user:
 * - Dice EPT = global growth rate (money from bank, lifts all boats)
 * - Property EPT = wealth TRANSFER between players (zero-sum)
 *
 * Formula for relative position:
 *   totalPropertyEPT = sum of all property EPT in the game
 *   avgPropertyEPT = totalPropertyEPT / numPlayers
 *   relativeEPT[i] = player[i].propertyEPT - avgPropertyEPT
 *
 * This measures how each player grows RELATIVE to others.
 * Positive = gaining ground, Negative = losing ground
 *
 * We can also estimate "turns until broke":
 *   turnsUntilBroke = netWorth / |negativeRelativeEPT|
 * (Though this varies as they sell assets)
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

console.log('='.repeat(70));
console.log('RELATIVE EPT ANALYSIS');
console.log('='.repeat(70));

// =============================================================================
// DICE EPT - Global Growth Rate
// =============================================================================

console.log('\n1. DICE EPT (Money from Bank)');
console.log('-'.repeat(70));

// Go: ~$200 every 5-6 turns
const avgTurnsPerCircuit = 40 / 7;
const goEPT = 200 / avgTurnsPerCircuit;

// Chance/CC simplified
const chanceEPT = 0.075 * 25;  // ~7.5% chance, ~$25 avg when landing
const ccEPT = 0.075 * 20;

const diceEPT = goEPT + chanceEPT + ccEPT;
console.log(`  Go:              $${goEPT.toFixed(1)}/turn`);
console.log(`  Chance/CC:       $${(chanceEPT + ccEPT).toFixed(1)}/turn`);
console.log(`  TOTAL DICE EPT:  $${diceEPT.toFixed(1)}/turn per player`);
console.log(`\n  This is the "tide that lifts all boats" - everyone gains roughly equally`);

// =============================================================================
// PROPERTY EPT BY GROUP
// =============================================================================

console.log('\n2. PROPERTY EPT BY GROUP (at 3 houses, 3 opponents)');
console.log('-'.repeat(70));

const opponents = 3;
const groupEPT = {};

for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
    let ept = 0;
    for (const sq of group.squares) {
        ept += probs[sq] * BOARD[sq].rent[3] * opponents;
    }
    groupEPT[groupName] = ept;
}

// Sort by EPT
const sortedGroups = Object.entries(groupEPT).sort((a, b) => b[1] - a[1]);

console.log(`  Group        | EPT/turn | vs Dice EPT`);
console.log(`  ${'-'.repeat(45)}`);
for (const [name, ept] of sortedGroups) {
    console.log(`  ${name.padEnd(12)} | $${ept.toFixed(1).padStart(6)} | ${(ept / diceEPT).toFixed(1)}x`);
}

// =============================================================================
// RELATIVE EPT FORMULA
// =============================================================================

console.log('\n3. RELATIVE EPT FORMULA');
console.log('-'.repeat(70));

console.log(`
  Total Property EPT = Σ(all players' property EPT)
  Avg Property EPT = Total / numPlayers

  Relative EPT[i] = Player[i].PropertyEPT - AvgPropertyEPT

  Interpretation:
  - Positive: Player is gaining ground (taking from others)
  - Zero: Player is breaking even with the group
  - Negative: Player is losing ground (paying to others)

  The sum of all Relative EPT = 0 (zero-sum!)
`);

// =============================================================================
// EXAMPLE SCENARIOS
// =============================================================================

console.log('\n4. EXAMPLE SCENARIOS');
console.log('-'.repeat(70));

function analyzeScenario(name, playerEPTs) {
    const numPlayers = playerEPTs.length;
    const totalEPT = playerEPTs.reduce((a, b) => a + b, 0);
    const avgEPT = totalEPT / numPlayers;

    console.log(`\n  ${name}`);
    console.log(`  Total Property EPT: $${totalEPT.toFixed(1)}/turn`);
    console.log(`  Avg Property EPT: $${avgEPT.toFixed(1)}/turn`);
    console.log(`\n  Player | Property EPT | Relative EPT | Net Growth (w/dice)`);
    console.log(`  ${'-'.repeat(60)}`);

    for (let i = 0; i < numPlayers; i++) {
        const relEPT = playerEPTs[i] - avgEPT;
        const netGrowth = diceEPT + relEPT;  // Dice EPT + relative property EPT
        const status = relEPT > 5 ? '📈' : relEPT < -5 ? '📉' : '➡️';
        console.log(`    ${i + 1}    |    $${playerEPTs[i].toFixed(1).padStart(5)}    |   $${relEPT.toFixed(1).padStart(6)}    |   $${netGrowth.toFixed(1).padStart(5)}/turn ${status}`);
    }

    // Verify zero-sum
    const sumRelative = playerEPTs.reduce((sum, ept) => sum + (ept - avgEPT), 0);
    console.log(`\n  Sum of Relative EPT: $${sumRelative.toFixed(2)} (should be ~0)`);
}

// Scenario 1: No monopolies
console.log('\n  --- Scenario A: Early game, scattered properties ---');
analyzeScenario('No monopolies (scattered properties)', [8, 6, 10, 4]);

// Scenario 2: One player has Orange
console.log('\n  --- Scenario B: Player 1 has Orange with 3 houses ---');
analyzeScenario('Player 1 has Orange monopoly', [groupEPT.orange, 5, 5, 5]);

// Scenario 3: Two players have monopolies
console.log('\n  --- Scenario C: Player 1 has Orange, Player 2 has Green ---');
analyzeScenario('Two monopolies', [groupEPT.orange, groupEPT.green, 5, 5]);

// Scenario 4: Extreme - one player dominates
console.log('\n  --- Scenario D: Player 1 has Orange + Red (dominant) ---');
analyzeScenario('Dominant player', [groupEPT.orange + groupEPT.red, 5, 5, 5]);

// =============================================================================
// TURNS UNTIL BROKE ESTIMATE
// =============================================================================

console.log('\n5. TURNS UNTIL BROKE ESTIMATE');
console.log('-'.repeat(70));

console.log(`
  When relativeEPT is negative, player is losing ground.

  Simplified estimate: turnsUntilBroke = netWorth / |relativeEPT|

  Caveats:
  - Assumes constant EPT (actually drops as they sell assets)
  - Doesn't account for lucky dice rolls
  - Net worth includes illiquid assets (properties)

  Still useful as a "danger signal" for trade evaluation.
`);

function estimateTurnsUntilBroke(netWorth, relativeEPT) {
    if (relativeEPT >= 0) return Infinity;
    return netWorth / Math.abs(relativeEPT);
}

// Example
const scenarios = [
    { name: 'Player with $1500, losing $20/turn', netWorth: 1500, relEPT: -20 },
    { name: 'Player with $800, losing $40/turn', netWorth: 800, relEPT: -40 },
    { name: 'Player with $2000, losing $10/turn', netWorth: 2000, relEPT: -10 },
];

console.log(`  Scenario                              | Est. Turns Until Broke`);
console.log(`  ${'-'.repeat(60)}`);
for (const s of scenarios) {
    const turns = estimateTurnsUntilBroke(s.netWorth, s.relEPT);
    console.log(`  ${s.name.padEnd(40)}| ${turns.toFixed(0)} turns`);
}

// =============================================================================
// POSITION FORMULA WITH RELATIVE EPT
// =============================================================================

console.log('\n6. NEW POSITION FORMULA');
console.log('-'.repeat(70));

console.log(`
  Old formula (absolute):
    position = cash + EPT * turns

  New formula (relative):
    netWorth = cash + propertyValue + houseValue
    relativeEPT = myPropertyEPT - avgPropertyEPT

    position = netWorth + (diceEPT + relativeEPT) * turnsRemaining

  For trade evaluation:
    Δposition = Δnetworth + ΔrelativeEPT * turnsRemaining

  The key insight: When I enable opponent's monopoly:
  - Their relativeEPT goes UP (they gain property EPT)
  - MY relativeEPT goes DOWN (avg goes up, I stay same or pay them)
  - DOUBLE whammy!
`);

// =============================================================================
// TRADE IMPACT CALCULATION
// =============================================================================

console.log('\n7. TRADE IMPACT WITH RELATIVE EPT');
console.log('-'.repeat(70));

console.log(`
  Scenario: Player B sells New York Ave to Player A, completing Orange

  BEFORE:
    A: PropertyEPT = $10, RelativeEPT = $10 - $7 = +$3
    B: PropertyEPT = $6,  RelativeEPT = $6 - $7 = -$1
    C: PropertyEPT = $5,  RelativeEPT = $5 - $7 = -$2
    D: PropertyEPT = $5,  RelativeEPT = $5 - $7 = -$2
    (Total = $26, Avg = $6.5)

  AFTER (A has Orange @ 3 houses):
    A: PropertyEPT = $${groupEPT.orange.toFixed(0)}, RelativeEPT = ...
    B: PropertyEPT = $0,  RelativeEPT = ...
    C: PropertyEPT = $5,  RelativeEPT = ...
    D: PropertyEPT = $5,  RelativeEPT = ...
`);

const afterTotal = groupEPT.orange + 0 + 5 + 5;
const afterAvg = afterTotal / 4;

console.log(`    (Total = $${afterTotal.toFixed(0)}, Avg = $${afterAvg.toFixed(1)})`);
console.log(`\n    A: RelativeEPT = $${groupEPT.orange.toFixed(0)} - $${afterAvg.toFixed(1)} = +$${(groupEPT.orange - afterAvg).toFixed(1)}`);
console.log(`    B: RelativeEPT = $0 - $${afterAvg.toFixed(1)} = -$${afterAvg.toFixed(1)}`);
console.log(`    C: RelativeEPT = $5 - $${afterAvg.toFixed(1)} = -$${(afterAvg - 5).toFixed(1)}`);
console.log(`    D: RelativeEPT = $5 - $${afterAvg.toFixed(1)} = -$${(afterAvg - 5).toFixed(1)}`);

const beforeBRelEPT = 6 - 6.5;
const afterBRelEPT = 0 - afterAvg;
const bRelEPTChange = afterBRelEPT - beforeBRelEPT;

console.log(`\n  Player B's RelativeEPT change: $${beforeBRelEPT.toFixed(1)} → $${afterBRelEPT.toFixed(1)} = ${bRelEPTChange.toFixed(1)}/turn`);
console.log(`  Over 50 turns: $${(bRelEPTChange * 50).toFixed(0)} position loss!`);
console.log(`\n  This is why B should demand HUGE compensation for enabling A's monopoly.`);

// =============================================================================
// GA RESULTS INTERPRETATION
// =============================================================================

console.log('\n8. GA RESULTS IN LIGHT OF RELATIVE EPT');
console.log('-'.repeat(70));

console.log(`
  GA found optimal parameters (40% win rate):
  - sellerShareThreshold: 0.30 (demand 30% of their gain)
  - leaderPenaltyMultiplier: 1.80 (demand 80% more from leader)
  - dominancePenaltyMultiplier: 2.30 (demand 130% more to prevent dominance)
  - underdogBonus: 0.65 (give 35% discount to underdogs)
  - discountRate: 0.015 (lower = values future more)

  The relative EPT framework explains these:
  - Lower sellerShare works because it gets more trades done
  - Higher leader/dominance penalties protect relative position
  - Underdog bonus: helping them doesn't hurt your relative position as much
  - Lower discount rate: relative advantages compound over time!
`);

console.log('\n' + '='.repeat(70));
console.log('NEXT STEPS');
console.log('='.repeat(70));
console.log(`
  1. Implement relative EPT calculation in position estimator
  2. Use relative growth rate instead of absolute EPT for trade valuation
  3. Track "turns until broke" as a danger signal
  4. Test if this reduces conservatism while maintaining good decisions
`);
