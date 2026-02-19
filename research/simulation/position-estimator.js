/**
 * Competitive Position Estimator
 *
 * For each player, estimate their "position" and "turns to lead"
 *
 * Position = EPT × T + Cash
 *   where T = estimated turns remaining
 *
 * A player's trajectory: at turn t, their value will be approximately
 *   Value(t) = Cash + EPT × t
 *
 * Two players cross when:
 *   Cash_A + EPT_A × t = Cash_B + EPT_B × t
 *   t = (Cash_B - Cash_A) / (EPT_A - EPT_B)
 *
 * This tells us: if I have higher EPT but less cash, how many turns
 * until I overtake them?
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
 * Calculate a player's EPT (expected earnings per turn)
 */
function calculatePlayerEPT(player, state) {
    const activePlayers = state.players.filter(p => !p.bankrupt);
    const opponents = activePlayers.length - 1;
    if (opponents === 0) return 0;

    let totalEPT = 0;

    for (const prop of player.properties) {
        const propState = state.propertyStates[prop];
        const square = BOARD[prop];

        if (!square.rent) continue;

        const houses = propState.houses || 0;
        let rent;

        // Check for monopoly
        if (square.group) {
            const groupSquares = COLOR_GROUPS[square.group].squares;
            const ownsAll = groupSquares.every(sq =>
                state.propertyStates[sq]?.owner === player.id
            );

            if (ownsAll) {
                rent = houses === 0 ? square.rent[0] * 2 : square.rent[houses];
            } else {
                rent = square.rent[0];
            }
        } else {
            rent = square.rent[houses] || square.rent[0];
        }

        const prob = probs[prop] || 0.025;
        totalEPT += prob * rent * opponents;
    }

    return totalEPT;
}

/**
 * Calculate a player's current "position" (projected value)
 * Position = Cash + EPT × turnsRemaining
 */
function calculatePosition(player, state, turnsRemaining = 50) {
    const ept = calculatePlayerEPT(player, state);
    return player.money + ept * turnsRemaining;
}

/**
 * Calculate turns until player A overtakes player B
 * Returns Infinity if A will never overtake (lower EPT and less cash)
 * Returns 0 if A is already ahead
 * Returns negative if A is ahead but falling behind
 */
function turnsToOvertake(playerA, playerB, state) {
    const eptA = calculatePlayerEPT(playerA, state);
    const eptB = calculatePlayerEPT(playerB, state);
    const cashA = playerA.money;
    const cashB = playerB.money;

    // If A is already ahead in both, return 0
    if (cashA >= cashB && eptA >= eptB) return 0;

    // If A is behind in both, return Infinity
    if (cashA <= cashB && eptA <= eptB) return Infinity;

    // Otherwise, calculate crossover point
    // cashA + eptA × t = cashB + eptB × t
    // t = (cashB - cashA) / (eptA - eptB)
    const turns = (cashB - cashA) / (eptA - eptB);

    return turns;
}

/**
 * Full competitive analysis for a player
 */
function analyzePosition(player, state, turnsRemaining = 50) {
    const activePlayers = state.players.filter(p => !p.bankrupt);

    const myEPT = calculatePlayerEPT(player, state);
    const myPosition = calculatePosition(player, state, turnsRemaining);

    // Compare to all other players
    const comparisons = [];
    let rank = 1;

    for (const other of activePlayers) {
        if (other.id === player.id) continue;

        const otherEPT = calculatePlayerEPT(other, state);
        const otherPosition = calculatePosition(other, state, turnsRemaining);
        const turnsToPass = turnsToOvertake(player, other, state);

        if (otherPosition > myPosition) rank++;

        comparisons.push({
            playerId: other.id,
            theirEPT: otherEPT,
            theirPosition: otherPosition,
            turnsToOvertake: turnsToPass,
            iAmAhead: myPosition > otherPosition
        });
    }

    return {
        playerId: player.id,
        cash: player.money,
        ept: myEPT,
        position: myPosition,
        rank,
        comparisons
    };
}

/**
 * Would a trade improve my competitive position?
 *
 * @param player - The player considering the trade
 * @param cashChange - Cash gained (positive) or lost (negative)
 * @param eptChange - EPT gained (positive) or lost (negative)
 * @param state - Current game state
 */
function wouldTradeImprovePosition(player, cashChange, eptChange, state, turnsRemaining = 50) {
    const currentPosition = calculatePosition(player, state, turnsRemaining);
    const currentEPT = calculatePlayerEPT(player, state);

    // Simulate new position
    const newCash = player.money + cashChange;
    const newEPT = currentEPT + eptChange;
    const newPosition = newCash + newEPT * turnsRemaining;

    // Get current rank
    const activePlayers = state.players.filter(p => !p.bankrupt);
    let currentRank = 1;
    let newRank = 1;

    for (const other of activePlayers) {
        if (other.id === player.id) continue;
        const otherPosition = calculatePosition(other, state, turnsRemaining);

        if (otherPosition > currentPosition) currentRank++;
        if (otherPosition > newPosition) newRank++;
    }

    return {
        currentPosition,
        newPosition,
        positionChange: newPosition - currentPosition,
        currentRank,
        newRank,
        rankImproved: newRank < currentRank,
        rankWorsened: newRank > currentRank,
        isGoodTrade: newPosition >= currentPosition && newRank <= currentRank
    };
}

// =============================================================================
// DEMONSTRATION
// =============================================================================

console.log('='.repeat(60));
console.log('COMPETITIVE POSITION ESTIMATOR');
console.log('='.repeat(60));

// Create example scenarios
console.log('\n--- SCENARIO 1: Early game, no monopolies ---\n');

const scenario1 = {
    turn: 15,
    players: [
        { id: 0, money: 1200, bankrupt: false, properties: new Set([6, 8, 9]) },      // Some light blues
        { id: 1, money: 1400, bankrupt: false, properties: new Set([16, 18]) },       // 2/3 orange
        { id: 2, money: 1100, bankrupt: false, properties: new Set([11, 13, 14]) },   // Some pinks
        { id: 3, money: 1300, bankrupt: false, properties: new Set([19]) }            // NY Ave
    ],
    propertyStates: {
        6: { owner: 0, houses: 0 },
        8: { owner: 0, houses: 0 },
        9: { owner: 0, houses: 0 },
        11: { owner: 2, houses: 0 },
        13: { owner: 2, houses: 0 },
        14: { owner: 2, houses: 0 },
        16: { owner: 1, houses: 0 },
        18: { owner: 1, houses: 0 },
        19: { owner: 3, houses: 0 }
    }
};

console.log('Player positions (50 turns remaining):');
for (const player of scenario1.players) {
    const analysis = analyzePosition(player, scenario1, 50);
    console.log(`  Player ${player.id + 1}: Cash=$${player.money}, EPT=$${analysis.ept.toFixed(1)}, Position=$${analysis.position.toFixed(0)}, Rank=${analysis.rank}`);
}

// Now: Player 1 (has 2/3 orange) wants to buy NY Ave from Player 3
console.log('\n--- TRADE ANALYSIS: Player 2 buys NY Ave from Player 4 for $500 ---\n');

const player1 = scenario1.players[1];  // Buyer (has 2/3 orange)
const player3 = scenario1.players[3];  // Seller (has NY Ave)

// For buyer: loses $500 cash, gains Orange monopoly EPT
const orangeEPT = 152.59;  // At 3 houses with 3 opponents
const buyerAnalysis = wouldTradeImprovePosition(player1, -500, orangeEPT, scenario1, 50);

console.log('BUYER (Player 2) perspective:');
console.log(`  Current position: $${buyerAnalysis.currentPosition.toFixed(0)}, Rank ${buyerAnalysis.currentRank}`);
console.log(`  After trade:      $${buyerAnalysis.newPosition.toFixed(0)}, Rank ${buyerAnalysis.newRank}`);
console.log(`  Position change:  $${buyerAnalysis.positionChange.toFixed(0)}`);
console.log(`  Good trade? ${buyerAnalysis.isGoodTrade ? 'YES' : 'NO'}`);

// For seller: gains $500 cash, loses blocking position but doesn't change their EPT
const sellerAnalysis = wouldTradeImprovePosition(player3, 500, 0, scenario1, 50);

console.log('\nSELLER (Player 4) perspective:');
console.log(`  Current position: $${sellerAnalysis.currentPosition.toFixed(0)}, Rank ${sellerAnalysis.currentRank}`);
console.log(`  After trade:      $${sellerAnalysis.newPosition.toFixed(0)}, Rank ${sellerAnalysis.newRank}`);
console.log(`  Position change:  $${sellerAnalysis.positionChange.toFixed(0)}`);
console.log(`  Good trade? ${sellerAnalysis.isGoodTrade ? 'YES' : 'NO'}`);

// But wait - we need to account for OPPONENT'S position change too!
console.log('\n--- ACCOUNTING FOR OPPONENT GAINS ---\n');

// After trade, Player 1's position jumps massively
// This changes the rankings for everyone
console.log('If Player 2 completes Orange and builds 3 houses:');
console.log(`  Player 2's new EPT: ~$${orangeEPT.toFixed(0)}/turn`);
console.log(`  Player 2's new position: $${(player1.money - 500 + orangeEPT * 50).toFixed(0)}`);
console.log(`  Player 4's new position: $${(player3.money + 500).toFixed(0)}`);
console.log(`\n  Player 4 goes from Rank 2 to Rank 4!`);

// The key insight
console.log('\n' + '='.repeat(60));
console.log('KEY INSIGHT');
console.log('='.repeat(60));
console.log(`
The seller must consider not just their OWN position change,
but how the BUYER'S position change affects their rank.

Selling NY Ave for $500:
  - Seller's position: +$500 (good!)
  - Buyer's position: +$${(orangeEPT * 50 - 500).toFixed(0)} (massive jump!)
  - Seller's RANK: drops from 2nd to 4th (bad!)

A smart seller should ask:
  "What price would keep me from falling in rank?"

If buyer gains EPT × T from the monopoly, seller needs enough
cash to offset that in the rankings.

Minimum acceptable price ≈ (their EPT gain × T) / 2
  = $${(orangeEPT * 50 / 2).toFixed(0)} to stay competitive
`);

module.exports = {
    calculatePlayerEPT,
    calculatePosition,
    turnsToOvertake,
    analyzePosition,
    wouldTradeImprovePosition
};
