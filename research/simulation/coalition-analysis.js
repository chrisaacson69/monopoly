/**
 * Coalition Analysis for N-Player Monopoly Trading
 *
 * Explores the problem space of multi-player trade dynamics:
 * - How many meaningful trades exist?
 * - What's the impact of a trade on non-participants?
 * - Can we identify "blocking" opportunities?
 * - How complex is the coalition formation problem?
 */

'use strict';

const { BOARD, COLOR_GROUPS } = require('./game-engine.js');

let MarkovEngine;
try {
    MarkovEngine = require('../markov-engine.js').MarkovEngine;
} catch (e) {
    console.error('Required modules not found');
    process.exit(1);
}

// =============================================================================
// PROBLEM SPACE ANALYSIS
// =============================================================================

console.log('='.repeat(70));
console.log('COALITION ANALYSIS: Exploring the N>2 Player Problem Space');
console.log('='.repeat(70));

// Initialize engines
const markov = new MarkovEngine();
markov.initialize();
const probs = markov.getAllProbabilities('stay');

// Count tradeable properties
const tradeableProps = [];
for (let i = 0; i < 40; i++) {
    const sq = BOARD[i];
    if (sq.price && sq.group) {
        tradeableProps.push(i);
    }
}

console.log(`\n1. BASIC PROBLEM DIMENSIONS`);
console.log('-'.repeat(70));
console.log(`   Tradeable color properties: ${tradeableProps.length}`);
console.log(`   Color groups: ${Object.keys(COLOR_GROUPS).length}`);
console.log(`   Players: 4`);
console.log(`   Possible trading pairs: ${4 * 3 / 2} = 6`);

// Analyze meaningful trade types
console.log(`\n2. MEANINGFUL TRADE TYPES`);
console.log('-'.repeat(70));

// Type 1: Monopoly-completing trades (most important)
console.log(`\n   Type 1: Monopoly-Completing Trades`);
console.log(`   These are the high-value trades that matter most.`);

let monopolyCompletingScenarios = 0;
for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
    const size = group.squares.length;
    // For each group, count ways properties can be split requiring a trade
    // Player A has some, Player B has the rest
    for (let aOwns = 1; aOwns < size; aOwns++) {
        // A owns 'aOwns' properties, B owns the rest
        // This is a potential monopoly-completing trade
        monopolyCompletingScenarios++;
    }
}
console.log(`   Scenarios per group distribution: ${monopolyCompletingScenarios}`);
console.log(`   With 4 players assigning owners: ~${monopolyCompletingScenarios * 12} combinations`);

// Type 2: Mutual monopoly trades
console.log(`\n   Type 2: Mutual Monopoly Trades`);
console.log(`   Both players complete monopolies simultaneously.`);
const groupPairs = Object.keys(COLOR_GROUPS).length * (Object.keys(COLOR_GROUPS).length - 1) / 2;
console.log(`   Possible group pairs: ${groupPairs}`);

// Type 3: Cash-for-blocking-property
console.log(`\n   Type 3: Cash-for-Blocking Property`);
console.log(`   One player buys a property to complete their monopoly.`);
console.log(`   Cash discretized to ~20 meaningful levels ($100-$2000 in $100 steps)`);

// Total meaningful trades estimate
console.log(`\n   ESTIMATED MEANINGFUL TRADES PER GAME STATE:`);
console.log(`   - Monopoly-completing: ~50 (depends on ownership distribution)`);
console.log(`   - With cash variations: ~500`);
console.log(`   - Per trading pair: ~100`);
console.log(`   - Total per turn: ~600 trades to evaluate`);

// =============================================================================
// COALITION COMPLEXITY
// =============================================================================

console.log(`\n3. COALITION COMPLEXITY`);
console.log('-'.repeat(70));

console.log(`\n   The N>2 problem arises because:`);
console.log(`   - A trade between P1-P2 affects P3, P4`);
console.log(`   - P3 might counter-offer to prevent P1-P2 deal`);
console.log(`   - Multiple equilibria can exist`);

console.log(`\n   Coalition structures in 4-player game:`);
console.log(`   - No coalition: 4 independent players`);
console.log(`   - One pair: {1,2} vs {3} vs {4} = C(4,2) = 6 ways`);
console.log(`   - Two pairs: {1,2} vs {3,4} = 3 ways`);
console.log(`   - Triple: {1,2,3} vs {4} = 4 ways`);
console.log(`   - Grand coalition: {1,2,3,4} = 1 way`);
console.log(`   Total coalition structures: 15`);

console.log(`\n   But for TRADING decisions:`);
console.log(`   - Each trade is a local 2-player interaction`);
console.log(`   - External players can only BLOCK via counter-offers`);
console.log(`   - This reduces complexity significantly`);

// =============================================================================
// EXTERNALITY ANALYSIS
// =============================================================================

console.log(`\n4. TRADE EXTERNALITIES (Impact on Non-Participants)`);
console.log('-'.repeat(70));

// Create a sample game state
function createSampleState() {
    return {
        turn: 25,
        players: [
            { id: 0, money: 1000, bankrupt: false, properties: new Set([6, 8, 9]) },    // P0: Light blue
            { id: 1, money: 1000, bankrupt: false, properties: new Set([16, 18, 19]) }, // P1: Orange
            { id: 2, money: 1000, bankrupt: false, properties: new Set([11, 13, 14]) }, // P2: Pink
            { id: 3, money: 1000, bankrupt: false, properties: new Set([1, 3]) }        // P3: Has 2/3 brown
        ],
        propertyStates: {}
    };
}

// What happens when P0 trades with P1?
console.log(`\n   Sample scenario:`);
console.log(`   P0 owns: Light Blue (complete monopoly)`);
console.log(`   P1 owns: Orange (complete monopoly)`);
console.log(`   P2 owns: Pink (complete monopoly)`);
console.log(`   P3 owns: 2/3 Brown (needs Mediterranean from unowned)`);

console.log(`\n   If P0 and P1 trade cash, no externality to P2, P3.`);
console.log(`   If a property changes monopoly status, ALL players affected.`);

// Calculate the "externality" of a monopoly forming
console.log(`\n   EXTERNALITY CALCULATION:`);
console.log(`   When Player X gains a monopoly:`);

const opponents = 3;
for (const [groupName, group] of Object.entries(COLOR_GROUPS)) {
    let ept3H = 0;
    for (const sq of group.squares) {
        ept3H += probs[sq] * BOARD[sq].rent[3] * opponents;
    }
    // Externality = expected rent paid BY each opponent
    const externalityPerPlayer = ept3H / opponents;
    console.log(`   ${groupName.padEnd(12)}: $${externalityPerPlayer.toFixed(1)}/turn to each opponent`);
}

// =============================================================================
// BLOCKING VALUE ANALYSIS
// =============================================================================

console.log(`\n5. BLOCKING VALUE ANALYSIS`);
console.log('-'.repeat(70));

console.log(`\n   When should P3 intervene in a P1-P2 trade?`);
console.log(`   `);
console.log(`   Scenario: P1 offers P2 $500 for property X`);
console.log(`   Property X completes P1's Orange monopoly`);
console.log(`   `);
console.log(`   P3's options:`);
console.log(`   1. Do nothing: P1 gets Orange, P3 pays ~$50/turn more rent`);
console.log(`   2. Counter-offer: P3 offers P2 $600 for X (blocks P1)`);
console.log(`   `);
console.log(`   P3 should counter if: Cost of counter < NPV of avoided rent`);

// Calculate blocking threshold
const orangeEPT = probs[16] * BOARD[16].rent[3] +
                  probs[18] * BOARD[18].rent[3] +
                  probs[19] * BOARD[19].rent[3];
const externalityPerOpponent = orangeEPT;  // Rent paid per opponent per turn
const turnsRemaining = 50;
const blockingNPV = externalityPerOpponent * turnsRemaining * 0.5;  // Rough NPV

console.log(`\n   Orange monopoly externality: $${externalityPerOpponent.toFixed(1)}/turn`);
console.log(`   NPV of blocking (~50 turns): $${blockingNPV.toFixed(0)}`);
console.log(`   `);
console.log(`   This suggests P3 should bid up to $${blockingNPV.toFixed(0)} to block!`);
console.log(`   But P3 also needs to VALUE the property they're buying...`);

// =============================================================================
// SIMPLIFICATION STRATEGIES
// =============================================================================

console.log(`\n6. SIMPLIFICATION STRATEGIES`);
console.log('-'.repeat(70));

console.log(`\n   Strategy A: Ignore externalities (current approach)`);
console.log(`   - Each player optimizes their own trades`);
console.log(`   - Simple, but misses blocking opportunities`);
console.log(`   - Win rate: ~30% in round-robin (roughly equal)`);

console.log(`\n   Strategy B: Defensive blocking`);
console.log(`   - Before accepting a trade, check if it helps leader too much`);
console.log(`   - Reject trades that widen the gap with front-runner`);
console.log(`   - Adds O(1) computation per trade evaluation`);

console.log(`\n   Strategy C: Active counter-offering`);
console.log(`   - Monitor proposed trades between other players`);
console.log(`   - Compute if counter-offer is worthwhile`);
console.log(`   - Complexity: O(trades × players) per turn`);

console.log(`\n   Strategy D: Full coalition analysis`);
console.log(`   - Compute Nash equilibrium over all possible trades`);
console.log(`   - Complexity: Exponential in worst case`);
console.log(`   - May be tractable for small action spaces`);

// =============================================================================
// GENETIC ALGORITHM APPROACH
// =============================================================================

console.log(`\n7. GENETIC ALGORITHM APPROACH`);
console.log('-'.repeat(70));

console.log(`\n   Parameters to tune:`);
const params = [
    { name: 'sellerShareThreshold', range: [0.2, 0.5], current: 0.35 },
    { name: 'mutualTradeRatio', range: [0.6, 1.0], current: 0.8 },
    { name: 'cashOfferFraction', range: [0.3, 0.7], current: 0.5 },
    { name: 'blockingValueWeight', range: [0.2, 0.6], current: 0.4 },
    { name: 'projectionHorizon', range: [30, 70], current: 50 },
    { name: 'developmentReserveFraction', range: [0.2, 0.5], current: 0.35 },
];

console.log(`\n   Parameter          | Range        | Current`);
console.log(`   ` + '-'.repeat(50));
for (const p of params) {
    console.log(`   ${p.name.padEnd(20)} | [${p.range[0]}, ${p.range[1]}]`.padEnd(35) + ` | ${p.current}`);
}

console.log(`\n   Genome size: ${params.length} parameters`);
console.log(`   Search space: Continuous, ~10^${params.length} discrete points at 0.01 resolution`);
console.log(`   `);
console.log(`   GA approach:`);
console.log(`   - Population: 50 parameter sets`);
console.log(`   - Fitness: Win rate in 100-game round-robin`);
console.log(`   - Generations: 100`);
console.log(`   - Total games: 50 × 100 × 100 = 500,000`);
console.log(`   - Estimated time: ~1 hour`);

// =============================================================================
// RECOMMENDATION
// =============================================================================

console.log(`\n8. RECOMMENDATION`);
console.log('-'.repeat(70));

console.log(`
   Given the analysis, I suggest a HYBRID approach:

   SHORT TERM: Implement Strategy B (Defensive Blocking)
   - Add a check: "Does this trade help the leader disproportionately?"
   - If so, demand higher compensation or reject
   - Low complexity, addresses the worst exploitation

   MEDIUM TERM: Genetic Algorithm for parameter tuning
   - Tune the 6 key parameters against diverse opponent pool
   - Include multiple AI types in fitness evaluation
   - Run overnight, get robust parameters

   LONG TERM: Explore Strategy C (Counter-offering)
   - Implement a "market" where all players can bid on trades
   - Most realistic but requires careful game rule design
   - May change game dynamics significantly

   The key insight is that FULL coalition analysis (Strategy D) is likely
   overkill for Monopoly. The game has enough randomness (dice, cards) that
   approximate solutions should perform well.
`);

// =============================================================================
// CONCRETE IMPLEMENTATION SUGGESTION
// =============================================================================

console.log(`\n9. CONCRETE NEXT STEP: Leader-Aware Trade Evaluation`);
console.log('-'.repeat(70));

console.log(`
   Add this check to evaluateTrade():

   function evaluateTrade(offer, state) {
       // ... existing evaluation ...

       // NEW: Leader-awareness check
       const positions = calculatePlayerPositions(state);
       const myRank = positions.findIndex(p => p.id === this.player.id);
       const theirRank = positions.findIndex(p => p.id === offer.from.id);

       // If they're the leader and this helps them, be more demanding
       if (theirRank === 0 && myRank > 1) {
           // They're winning, I'm not second place
           // Demand extra compensation to not help the leader
           minCashRequired *= 1.5;
       }

       // If this trade would make them the leader, consider blocking
       const theirNewPosition = estimatePositionAfterTrade(offer.from, state, offer);
       if (theirNewPosition > positions[0].value) {
           // This would make them the leader!
           // Strongly consider rejecting or demanding huge premium
           minCashRequired *= 2.0;
       }

       return cash >= minCashRequired;
   }

   This is simple, O(1), and addresses the "don't help the leader" problem.
`);
