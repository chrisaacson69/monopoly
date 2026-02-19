/**
 * NPV-Based Trade Valuator
 *
 * Values trades using Net Present Value (NPV) calculations.
 *
 * Key insight: EPT is like an interest rate on your position.
 * A monopoly generating $150 EPT/turn is equivalent to holding an
 * asset that pays $150/turn in perpetuity (until game ends).
 *
 * Fair trade principle:
 *   NPV(what I give up) = NPV(what I receive)
 *
 * For cash-for-monopoly trades:
 *   Cash given = NPV(monopoly income stream)
 *   Cash = EPT × (1 - (1+r)^-n) / r   [annuity formula]
 *
 * Where:
 *   EPT = expected earnings per turn from monopoly
 *   r = discount rate per turn (opponent's EPT / total cash in game)
 *   n = expected turns remaining
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

// =============================================================================
// NPV CALCULATIONS
// =============================================================================

/**
 * Calculate the discount rate based on game state
 *
 * The discount rate represents the "opportunity cost" of capital.
 * In Monopoly, this is roughly: how fast is money being transferred?
 *
 * Higher EPT in the game = higher discount rate (money moves faster)
 */
function calculateDiscountRate(state) {
    // Calculate total EPT in the game (all players' expected income)
    let totalEPT = 0;
    const activePlayers = state.players.filter(p => !p.bankrupt);

    for (const player of activePlayers) {
        for (const prop of player.properties) {
            const propState = state.propertyStates[prop];
            const square = BOARD[prop];

            if (square.rent) {
                const houses = propState.houses || 0;
                let rent;

                // Check for monopoly bonus
                if (square.group && player.hasMonopoly && player.hasMonopoly(square.group, state)) {
                    rent = houses === 0 ? square.rent[0] * 2 : square.rent[houses];
                } else {
                    rent = square.rent[houses] || square.rent[0];
                }

                const prob = probs[prop] || 0.025;
                const opponents = activePlayers.length - 1;
                totalEPT += prob * rent * opponents;
            }
        }
    }

    // Total cash in the game
    const totalCash = activePlayers.reduce((sum, p) => sum + p.money, 0);

    // Discount rate = EPT / Total Cash
    // This represents the "velocity" of money in the game
    // Early game: low EPT, high cash → low discount rate (~1-2%)
    // Late game: high EPT, less cash → high discount rate (5-10%+)

    const discountRate = totalCash > 0 ? totalEPT / totalCash : 0.02;

    // Clamp to reasonable range
    return Math.max(0.01, Math.min(0.15, discountRate));
}

/**
 * Estimate turns remaining in the game
 *
 * Based on:
 * - Properties sold (game progress)
 * - Development level (acceleration factor)
 * - Number of active players
 */
function estimateTurnsRemaining(state) {
    const activePlayers = state.players.filter(p => !p.bankrupt).length;

    // Count properties sold and houses built
    let propertiesSold = 0;
    let totalHouses = 0;

    for (const [idx, propState] of Object.entries(state.propertyStates)) {
        if (propState.owner !== null) {
            propertiesSold++;
            totalHouses += propState.houses || 0;
        }
    }

    // Base estimate: games typically last 80-150 turns with trading
    // Fewer properties sold = more turns remaining
    const propertySaturation = propertiesSold / 28;
    const developmentLevel = totalHouses / 32;

    // More development = faster game end
    const baseRemaining = 100 - state.turn;
    const adjustedRemaining = baseRemaining * (1 - developmentLevel * 0.5);

    // Minimum 20 turns, maximum 150
    return Math.max(20, Math.min(150, adjustedRemaining));
}

/**
 * Calculate NPV of an income stream (EPT) over n turns at discount rate r
 *
 * NPV = EPT × (1 - (1+r)^-n) / r   [Present Value of Annuity]
 */
function calculateNPV(ept, discountRate, turns) {
    if (discountRate <= 0 || ept <= 0) return 0;

    // PV of annuity formula
    const pvFactor = (1 - Math.pow(1 + discountRate, -turns)) / discountRate;
    return ept * pvFactor;
}

/**
 * Calculate the fair cash value for a monopoly
 */
function calculateMonopolyNPV(group, state, discountRate, turnsRemaining) {
    const groupSquares = COLOR_GROUPS[group].squares;
    const opponents = state.players.filter(p => !p.bankrupt).length - 1;

    // Calculate EPT at 3 houses (typical development target)
    let ept3H = 0;
    for (const sq of groupSquares) {
        const prob = probs[sq] || 0.025;
        const rent3H = BOARD[sq].rent[3];
        ept3H += prob * rent3H * opponents;
    }

    // NPV of the income stream
    const npv = calculateNPV(ept3H, discountRate, turnsRemaining);

    // Subtract house investment cost (occurs immediately, no discounting)
    const houseCost = BOARD[groupSquares[0]].housePrice * 3 * groupSquares.length;

    return {
        ept: ept3H,
        grossNPV: npv,
        houseCost,
        netNPV: npv - houseCost
    };
}

/**
 * Analyze a trade using NPV
 */
function analyzeTradeNPV(trade, state) {
    const { from, to, fromProperties, toProperties, fromCash } = trade;

    const discountRate = calculateDiscountRate(state);
    const turnsRemaining = estimateTurnsRemaining(state);

    // Check if trade completes monopolies
    const fromGetsMonopoly = checkMonopolyCompletion(from, toProperties, state);
    const toGetsMonopoly = checkMonopolyCompletion(to, fromProperties, state);

    // Calculate NPV of what each side receives
    let fromReceivesNPV = 0;
    let toReceivesNPV = 0;

    if (fromGetsMonopoly) {
        const monopolyValue = calculateMonopolyNPV(fromGetsMonopoly, state, discountRate, turnsRemaining);
        fromReceivesNPV = monopolyValue.netNPV;
    }

    if (toGetsMonopoly) {
        const monopolyValue = calculateMonopolyNPV(toGetsMonopoly, state, discountRate, turnsRemaining);
        toReceivesNPV = monopolyValue.netNPV;
    }

    // Add cash component (cash has NPV = face value)
    // from pays cash, so: from loses cash, to gains cash
    fromReceivesNPV -= fromCash;
    toReceivesNPV += fromCash;

    // Calculate payback period
    // How many turns until the EPT advantage recovers cash difference?
    let paybackPeriod = null;
    if (fromGetsMonopoly && fromCash > 0) {
        const monopolyEPT = calculateMonopolyNPV(fromGetsMonopoly, state, discountRate, turnsRemaining).ept;
        paybackPeriod = fromCash / monopolyEPT;
    }

    return {
        discountRate,
        turnsRemaining,
        fromGetsMonopoly,
        toGetsMonopoly,
        fromReceivesNPV,
        toReceivesNPV,
        npvDifference: fromReceivesNPV - toReceivesNPV,
        paybackPeriod,
        isFair: Math.abs(fromReceivesNPV - toReceivesNPV) < 100  // Within $100 is "fair"
    };
}

function checkMonopolyCompletion(player, properties, state) {
    for (const prop of properties) {
        const square = BOARD[prop];
        if (!square.group) continue;

        const groupSquares = COLOR_GROUPS[square.group].squares;
        const wouldOwn = groupSquares.filter(sq =>
            (state.propertyStates[sq] && state.propertyStates[sq].owner === player.id) ||
            properties.has(sq)
        ).length;

        if (wouldOwn === groupSquares.length) return square.group;
    }
    return null;
}

// =============================================================================
// DEMONSTRATION
// =============================================================================

console.log('='.repeat(70));
console.log('NPV-BASED TRADE VALUATION');
console.log('='.repeat(70));

// Demonstrate with example scenarios
const scenarios = [
    {
        name: 'Early Game - Low Discount Rate',
        turn: 10,
        totalCash: 6000,  // 4 players × $1500
        totalEPT: 30,     // Few properties, no monopolies
    },
    {
        name: 'Mid Game - Medium Discount Rate',
        turn: 40,
        totalCash: 5000,
        totalEPT: 100,    // Some development
    },
    {
        name: 'Late Game - High Discount Rate',
        turn: 80,
        totalCash: 3000,
        totalEPT: 300,    // Multiple monopolies developed
    }
];

console.log('\nDISCOUNT RATES BY GAME PHASE:');
console.log('-'.repeat(70));

for (const scenario of scenarios) {
    const discountRate = scenario.totalEPT / scenario.totalCash;
    const turnsRemaining = Math.max(20, 100 - scenario.turn);

    console.log(`\n${scenario.name}:`);
    console.log(`  Turn: ${scenario.turn}, Cash: $${scenario.totalCash}, EPT: $${scenario.totalEPT}`);
    console.log(`  Discount Rate: ${(discountRate * 100).toFixed(2)}% per turn`);
    console.log(`  Turns Remaining: ~${turnsRemaining}`);

    // Calculate NPV of Orange monopoly in this scenario
    const orangeEPT = 152.59;  // From our earlier analysis
    const orangeHouseCost = 900;
    const orangeNPV = calculateNPV(orangeEPT, discountRate, turnsRemaining);

    console.log(`\n  Orange Monopoly Valuation:`);
    console.log(`    EPT@3H: $${orangeEPT.toFixed(2)}/turn`);
    console.log(`    Gross NPV: $${orangeNPV.toFixed(0)}`);
    console.log(`    House Cost: $${orangeHouseCost}`);
    console.log(`    Net NPV: $${(orangeNPV - orangeHouseCost).toFixed(0)}`);
}

console.log('\n' + '='.repeat(70));
console.log('FAIR TRADE CALCULATOR');
console.log('='.repeat(70));

// For each monopoly, show what the fair cash price should be
console.log('\nFAIR CASH PRICES FOR MONOPOLY-COMPLETING TRADES:');
console.log('(Assuming mid-game: 5% discount rate, 60 turns remaining)\n');

const discountRate = 0.05;
const turnsRemaining = 60;

const groups = ['brown', 'lightBlue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkBlue'];

console.log(String('Group').padEnd(12) +
            String('EPT@3H').padStart(10) +
            String('Gross NPV').padStart(12) +
            String('House Cost').padStart(12) +
            String('Net NPV').padStart(12) +
            String('Fair Cash').padStart(12));
console.log('-'.repeat(70));

for (const group of groups) {
    const squares = COLOR_GROUPS[group].squares;

    // Calculate EPT at 3 houses with 3 opponents
    let ept = 0;
    for (const sq of squares) {
        ept += (probs[sq] || 0.025) * BOARD[sq].rent[3] * 3;
    }

    const grossNPV = calculateNPV(ept, discountRate, turnsRemaining);
    const houseCost = BOARD[squares[0]].housePrice * 3 * squares.length;
    const netNPV = grossNPV - houseCost;

    // Fair cash = Net NPV (what the monopoly is worth after house investment)
    // Split: buyer gets 60%, seller demands 40% of net value
    const fairCash = netNPV * 0.5;  // 50-50 split of the value

    console.log(
        group.padEnd(12) +
        `$${ept.toFixed(0)}`.padStart(10) +
        `$${grossNPV.toFixed(0)}`.padStart(12) +
        `$${houseCost}`.padStart(12) +
        `$${netNPV.toFixed(0)}`.padStart(12) +
        `$${fairCash.toFixed(0)}`.padStart(12)
    );
}

console.log('\n' + '='.repeat(70));
console.log('PAYBACK PERIOD ANALYSIS');
console.log('='.repeat(70));

console.log('\nIf you pay X for a monopoly, how many turns to recover via rent?\n');

console.log(String('Group').padEnd(12) +
            String('EPT@3H').padStart(10) +
            String('Pay $500').padStart(12) +
            String('Pay $1000').padStart(12) +
            String('Pay $1500').padStart(12) +
            String('Pay $2000').padStart(12));
console.log('-'.repeat(70));

for (const group of groups) {
    const squares = COLOR_GROUPS[group].squares;

    let ept = 0;
    for (const sq of squares) {
        ept += (probs[sq] || 0.025) * BOARD[sq].rent[3] * 3;
    }

    console.log(
        group.padEnd(12) +
        `$${ept.toFixed(0)}`.padStart(10) +
        `${(500/ept).toFixed(1)} turns`.padStart(12) +
        `${(1000/ept).toFixed(1)} turns`.padStart(12) +
        `${(1500/ept).toFixed(1)} turns`.padStart(12) +
        `${(2000/ept).toFixed(1)} turns`.padStart(12)
    );
}

console.log(`
KEY INSIGHTS:
=============
1. Early game has LOW discount rates (1-2%) because EPT is low
   → Monopolies are worth MORE in NPV terms
   → Fair prices are HIGHER

2. Late game has HIGH discount rates (5-10%+) because EPT is high
   → Future income is discounted more heavily
   → Fair prices are LOWER (but you have less time to recoup)

3. Payback period is the simplest heuristic:
   - Under 10 turns: GREAT trade for buyer
   - 10-20 turns: GOOD trade
   - 20-40 turns: FAIR trade
   - Over 40 turns: BAD trade (might not recoup before game ends)

4. The seller should demand compensation based on:
   - NPV of the monopoly they're enabling
   - Their share (40-50% is reasonable)
   - Adjusted for game phase (discount rate)
`);

// Export for use in trading AI
module.exports = {
    calculateDiscountRate,
    estimateTurnsRemaining,
    calculateNPV,
    calculateMonopolyNPV,
    analyzeTradeNPV
};
